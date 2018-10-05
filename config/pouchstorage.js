/**
 * Copyright 2014, 2017 IBM Corp.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

// var nano = require('nano');
var PouchDB = require('pouchdb');
var when = require('when');
var util = require('util');
var fs = require('fs');
var _ = require("underscore");

var settings;
var appname;
var flowDb = null;
var currentFlowRev = null;
var currentSettingsRev = null;
var currentCredRev = null;
// var replication = process.env.POUCH_SYNC || false;

var libraryCache = {};

function prepopulateFlows(resolve) {
    var key = appname+"/"+"flow";
    util.log("prepopulateFlows");
    flowDb.get(key,function(err,doc) {
        var promises = [];
        if (err) {
            if (fs.existsSync(__dirname+"/defaults/flow.json")) {
                try {
                    var flow = fs.readFileSync(__dirname+"/defaults/flow.json","utf8");
                    var flows = JSON.parse(flow);
                    util.log("[pouchstorage] Installing default flow");
                    promises.push(pouchstorage.saveFlows(flows));
                } catch(err2) {
                    util.log("[pouchstorage] Failed to save default flow");
                    util.log(err2);
                }
            } else {
                util.log("[pouchstorage] No default flow found");
            }
            if (fs.existsSync(__dirname+"/defaults/flow_cred.json")) {
                try {
                    var cred = fs.readFileSync(__dirname+"/defaults/flow_cred.json","utf8");
                    var creds = JSON.parse(cred);
                    util.log("[pouchstorage] Installing default credentials");
                    promises.push(pouchstorage.saveCredentials(creds));
                } catch(err2) {
                    util.log("[pouchstorage] Failed to save default credentials");
                    util.log(err2);
                }
            } else {
                util.log("[pouchstorage] No default credentials found");
            }

            // Set up remote replication when possible.
            // if (replication) {
            promises.push(
                when.promise(
                    function(rej, resolv) {
                        // do one way, one-off sync from the server until completion
                        couchDb
                            .replicate
                            .from(remoteDb)
                            .on('complete', function(info) {
                                resolv(info);
                            }).on('error', function(err) {
                                rej(info);
                            });
                    }
                )
            );
            // }

            // promises.push();
            when.settle(promises).then(function() {
                resolve();
            });
        } else {
            // Sync and then go.
            promises.push(
                when.promise(
                    function(rej, resolv) {
                        // do one way, one-off sync from the server until completion
                        couchDb
                            .replicate
                            .from(remoteDb)
                            .on('complete', function(info) {
                                resolv(info);
                            }).on('error', function(err) {
                                rej(info);
                            });
                    }
                )
            );

            // promises.push();
            when.settle(promises).then(function() {
                resolve();
            });            
            // Flows already exist - leave them alone
            resolve();
        }
    }).catch(function(err) {
        console.error(err);
    });
}

var pouchstorage = {
    init: function(_settings) {
        util.log("init");
        settings = _settings;
        // console.log("settings = ", settings);
        flowDb = new PouchDB(settings.pouchFile);

        // use the "every document is a delta"
        // flowDb.plugin(require('delta-pouch'));
        // flowDb.plugin(require('pouchdb-upsert'));
        // Add "upsert".

        // var couchDb = {
        //     db: pouchDb
        // }
        appname = settings.couchAppname || require('os').hostname();
        var dbname = settings.couchDb||"nodered";
        pouchstorage.getSettings().then(function(doc) {
            if (doc.status == 404) {
                console.log("Settings were not found");
            } else {
                if (_.has(doc, "_rev")) {
                    currentSettingsRev = doc._rev;
                }
                if (_.has(doc.settings, "_credentialSecret")) {
                    settings._credentialSecret = doc.settings._credentialSecret;
                } else {
                    settings._credentialSecret = settings.credentialSecret;
                }
            }
            // settings = doc;
            // settings = _settings;
            // console.log("secret = ", settings._credentialSecret);
        }, function(err) {
            // ignore for now.
            console.log("error getting settings initially: ", err);
        });        

        return when.promise(function(resolve,reject) {
        //     prepopulateFlows(resolve);
        // });            
            // couchDb.db.get(dbname,function(err,body) {
            //     if (err) {
            //         couchDb.db.create(dbname,function(err,body) {
            //             if (err) {
            //                 reject("Failed to create database: "+err);
            //             } else {
            //                 flowDb = couchDb.use(dbname);
                flowDb.post({
                    _id: "_design/library",
                    views:{
                        flow_entries_by_app_and_type:{
                            map:function(doc) {
                                var p = doc._id.split("/");
                                if (p.length > 2 && p[2] == "flow") {
                                    var meta = {path:p.slice(3).join("/")};
                                    emit([p[0],p[2]],meta);
                                }
                            }
                        },
                        lib_entries_by_app_and_type:{
                            map:function(doc) {
                                var p = doc._id.split("/");
                                if (p.length > 2) {
                                    if (p[2] != "flow") {
                                        var pathParts = p.slice(3,-1);
                                        for (var i=0;i<pathParts.length;i++) {
                                            emit([p[0],p[2],pathParts.slice(0,i).join("/")],{dir:pathParts.slice(i,i+1)[0]});
                                        }
                                        var meta = {};
                                        for (var key in doc.meta) {
                                            meta[key] = doc.meta[key];
                                        }
                                        meta.fn = p.slice(-1)[0];
                                        emit([p[0],p[2],pathParts.join("/")],meta);
                                    }
                                }
                            }
                        }
                    }
                },function(err,b) {
                    if (err) {
                        if (err.status == 409) {
                            // Already have a view, don't fail.
                            // console.log("Views already existed");
                            prepopulateFlows(resolve);
                        } else {
                            reject("Failed to create view: "+err);                              
                        }
                        // console.log("rejecting library view creation");
                    } else {
                        console.log("Created views");
                        prepopulateFlows(resolve);                        
                    }
                });
            });
                // } else {
                //     flowDb = couchDb.use(dbname);
                //     prepopulateFlows(resolve);
                // }
    },

    getFlows: function() {
        util.log("getFlows");        
        var key = appname+"/"+"flow";
        return when.promise(function(resolve,reject) {
            util.log("getFlows");
            flowDb.get(key,function(err,doc) {
                if (err) {
                    if (err.status != 404) {
                        console.log("rejecting getFlows");
                        reject(err.toString());
                    } else {
                        resolve([]);
                    }
                } else {
                    currentFlowRev = doc._rev;
                    resolve(doc.flow);
                }
            }).catch(function(err) {
                console.error(err);
            });
        });
    },

    saveFlows: function(flows) {
        var key = appname+"/"+"flow";
        util.log("saveFlows");
        return when.promise(function(resolve,reject) {            
            var doc = {_id:key,flow:flows};
            if (currentFlowRev) {
                doc._rev = currentFlowRev;
            }
            flowDb.put(doc,function(err,db) {
                if (err) {
                    if (err.name == "conflict") {
                        console.error("Save Flows failed because of a conflict");
                        console.log(doc);
                    } else {
                        console.log(err);
                        console.log("Rejecting SaveFlows");
                        reject(err.toString());                        
                    }
                } else {
                    currentFlowRev = db.rev;
                    resolve();
                }
            });
        });
    },

    getCredentials: function() {
        var key = appname+"/"+"credential";
        util.log("getCredentials");
        return when.promise(function(resolve,reject) {
            flowDb.get(key,function(err,doc) {
                console.log(err, doc);
                if (err) {
                    if (err.status != 404) {
                        console.log("Rejecting getCredentials");
                        console.error(err);
                        reject(err.toString());
                    } else {
                        resolve({});
                    }
                } else {
                    // currentCredRev = doc._rev;
                    resolve(doc.credentials);
                }
            }).catch(function(err) {
                console.error(err);
            });
        });
    },

    saveCredentials: function(credentials) {
        var key = appname+"/"+"credential";
        util.log("saveCredentials");
        return when.promise(function(resolve,reject) {
            function retryUntilWritten(doc) {
              // util.log(doc);
              return flowDb.get(key).then(function (origDoc) {
                // doc = origDoc;
                doc._rev = origDoc._rev;
                // doc.credentials = credentials;
                resolve(flowDb.put(doc));
              }).catch(function (err) {
                if (err.status === 409) {
                  return retryUntilWritten(doc);
                } else { // new doc
                  resolve(flowDb.put(doc));
                }
              });
            }
            retryUntilWritten({_id:key,credentials: credentials});

            // var doc = {_id:key,credentials:credentials};
            // if (currentCredRev) {
            //     doc._rev = currentCredRev;
            // }
            // flowDb.put(doc,function(err,db) {
            //     if (err) {
            //         if (err.name == "conflict") {
            //             console.error("Rejecting saveCredentials because of conflict");
            //             console.log(credentials);
            //             console.log(currentCredRev);
            //             console.log(doc._rev);
            //             resolve();
            //             // reject(err.toString);
            //         } else {
            //             console.log("Rejecting saveCredentials");
            //             console.log(err);
            //             reject(err.toString());                        
            //         }
            //     } else {
            //         currentCredRev = db.rev;
            //         resolve();
            //     }
            // });
        });
    },

    getSettings: function() {
        var key = appname+"/"+"settings";
        util.log("getSettings: ", key);
        return when.promise(function(resolve,reject) {
            flowDb.get(key,function(err,doc) {
                if (err) {
                    if (err.status != 404) {
                        console.log("Rejecting settings retrieval");
                        reject(err.toString());
                    } else {
                        resolve({});
                    }
                } else {
                    currentSettingsRev = doc._rev;
                    resolve(doc.settings);
                }
            }).catch(function(err) {
                console.error(err);
            });
        });
    },

    saveSettings: function(settings) {
        var key = appname+"/"+"settings";
        util.log("saveSettings");
        return when.promise(function(resolve,reject) {        
            function retryUntilWritten(doc) {
              return flowDb.get(key).then(function (origDoc) {
                doc._rev = origDoc._rev;
                resolve(flowDb.put(doc));
              }).catch(function (err) {
                if (err.status === 409) {
                  retryUntilWritten(doc);
                } else { // new doc
                    resolve(flowDb.put(doc));
                }
              });
            }
            retryUntilWritten({_id:key,settings: settings})
        });

        // return when.promise(function(resolve,reject) {
        //     var doc = {_id:key,settings:settings};
        //     if (currentSettingsRev) {
        //         doc._rev = currentSettingsRev;
        //     }
        //     console.log("Current settings: ", doc);
        //     flowDb.put(doc,function(err,db) {
        //         if (err) {
        //             // Ignore conflicts - there were already settings so we'll use those.
        //             // reject(err.toString());
        //             console.warn("Conflict detected when loading settings.  Using existing settings");
        //             resolve();
        //         } else {
        //             currentSettingsRev = db.rev;
        //             resolve();
        //         }
        //     });
        // });
    },

    getAllFlows: function() {
        util.log("Get all flows");
        return pouchstorage.getFlows()
    },
    // getAllFlows: function() {
    //     var key = [appname,"flow"];
    //     util.log("getAllFlows");
    //     return when.promise(function(resolve,reject) {
    //         flowDb.allDocs({include_docs: true}, function(e, data) {
    //             if (e) {
    //                 reject(e);
    //             } else {
    //                 for (var i = 0; i < data.length; i++) {
    //                     switch (data[i].id) {
    //                         case key
    //                     }
    //                 }
    //                 console.log(data);
    //                 // currentFlowRev = data._rev;
    //                 // pouchstorage.getFlows();
    //                 // resolve(data);
    //                 // var result = {};
    //                 // for (var i=0;i<data.rows.length;i++) {
    //                 //     var doc = data.rows[i];
    //                 //     var path = doc.value.path;
    //                 //     var parts = path.split("/");
    //                 //     var ref = result;
    //                 //     for (var j=0;j<parts.length-1;j++) {
    //                 //         ref['d'] = ref['d']||{};
    //                 //         ref['d'][parts[j]] = ref['d'][parts[j]]||{};
    //                 //         ref = ref['d'][parts[j]];
    //                 //     }
    //                 //     ref['f'] = ref['f']||[];
    //                 //     ref['f'].push(parts.slice(-1)[0]);
    //                 // }
    //                 // resolve(result);
    //             }
    //         });
    //     });
        //     flowDb.view('library','flow_entries_by_app_and_type',{key:key}, function(e,data) {
        //         if (e) {
        //             console.log("Rejecting library view retrieval");
        //             reject(e.toString());
        //         } else {
        //             var result = {};
        //             for (var i=0;i<data.rows.length;i++) {
        //                 var doc = data.rows[i];
        //                 var path = doc.value.path;
        //                 var parts = path.split("/");
        //                 var ref = result;
        //                 for (var j=0;j<parts.length-1;j++) {
        //                     ref['d'] = ref['d']||{};
        //                     ref['d'][parts[j]] = ref['d'][parts[j]]||{};
        //                     ref = ref['d'][parts[j]];
        //                 }
        //                 ref['f'] = ref['f']||[];
        //                 ref['f'].push(parts.slice(-1)[0]);
        //             }
        //             resolve(result);
        //         }
        //     });
        // });
    // },

    getFlow: function(fn) {
        util.log("getFlow");        
        if (fn.substr(0) != "/") {
            fn = "/"+fn;
        }
        var key = appname+"/lib/flow"+fn;
        return when.promise(function(resolve,reject) {
            flowDb.get(key,function(err,data) {
                if (err) {
                    console.log("rejecting getFlow");
                    reject(err);
                } else {
                    resolve(data.data);
                }
            }).catch(function(err) {
                console.error(err);
            });
        });
    },

    saveFlow: function(fn,data) {
        util.log("saveFlow");        
        if (fn.substr(0) != "/") {
            fn = "/"+fn;
        }
        var key = appname+"/lib/flow"+fn;
        return when.promise(function(resolve,reject) {
            var doc = {_id:key,data:data};
            flowDb.get(key,function(err,d) {
                if (d) {
                    doc._rev = d._rev;
                }
                flowDb.put(doc,function(err,d) {
                    if (err) {
                        console.log("Rejecting Save Flow");
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            }).catch(function(err) {
                console.error(err);
            });

        });
    },

    getLibraryEntry: function(type,path) {
        util.log("getLibraryEntry");        
        if (path != "" && path.substr(0,1) != "/") {
            var key = appname+"/lib/"+type+"/"+path;
        } else {
            var key = appname+"/lib/"+type+path;
        }
        
        if (libraryCache[key]) {
            return when.resolve(libraryCache[key]);
        }

        return when.promise(function(resolve,reject) {
            flowDb.get(key,function(err,doc) {
                if (err) {
                    if (path.substr(-1,1) == "/") {
                        path = path.substr(0,path.length-1);
                    }
                    var qkey = [appname,type,path];
                    flowDb.query('library','lib_entries_by_app_and_type',{key:qkey}, function(e,data) {
                        if (e) {
                            console.log("Rejecting getLibraryEntry");
                            reject(e);
                        } else {
                            var dirs = [];
                            var files = [];
                            for (var i=0;i<data.rows.length;i++) {
                                var row = data.rows[i];
                                var value = row.value;

                                if (value.dir) {
                                    if (dirs.indexOf(value.dir) == -1) {
                                        dirs.push(value.dir);
                                    }
                                } else {
                                    files.push(value);
                                }
                            }
                            libraryCache[key] = dirs.concat(files);
                            resolve(libraryCache[key]);
                        }
                    });
                } else {
                    libraryCache[key] = doc.body;
                    resolve(doc.body);
                }
            }).catch(function(err) {
                console.error(err);
            });
        });
    },
    saveLibraryEntry: function(type,path,meta,body) {
        util.log("saveLibraryEntry");
        var p = path.split("/");    // strip multiple slash   
        p = p.filter(Boolean);
        path = p.slice(0,p.length).join("/")
                
        if (path != "" && path.substr(0,1) != "/") {
            path = "/"+path;
        }
        var key = appname+"/lib/"+type+path;
        return when.promise(function(resolve,reject) {
            var doc = {_id:key,meta:meta,body:body};
            flowDb.get(key,function(err,d) {
                if (d) {
                    doc._rev = d._rev;
                }
                flowDb.put(doc,function(err,d) {
                    if (err) {
                        console.log("Rejecting saveLibraryEntry");
                        reject(err);
                    } else {
                        var p = path.split("/");
                        for (var i=0;i<p.length;i++) {
                            delete libraryCache[appname+"/lib/"+type+(p.slice(0,i).join("/"))]
                        }
                        libraryCache[key] = body;
                        resolve();
                    }
                });
            }).catch(function(err) {
                console.error(err);
            });

        });
    }
};

module.exports = pouchstorage;