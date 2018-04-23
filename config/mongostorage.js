/**
 * Copyright 2014 IBM Corp.
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

var mongo = require('mongodb');
var when = require('when');
var util = require('util');

var settings;

var mongodb;
var appname;

//var heartBeatLastSent = (new Date()).getTime();
//
//setInterval(function () {
//    var now = (new Date()).getTime();
//    if (mongodb && now - heartBeatLastSent > 15000) {
//        heartBeatLastSent = now;
//        mongodb.command({ ping: 1}, function (err, result) {});
//    }
//}, 15000);

function jconv(credentials) {
    var jconvs = {};
    console.log("Jconv");
    for (id in credentials) {
        // Need to get rid of leading _ first.  Otherwise we end up with .$ instead of $.
        var newId = id.replace("_$", "$");
        // newId = newId.replace("_", ".");
        jconvs[newId] = credentials[id];
    }
    return jconvs;
}

function bconv(credentials) {
    var bconvs = {};
    console.log("Bconv");
    for (id in credentials) {
        // var newId = id.replace(".", "_");
        var newId = id.replace("$", "_$");
        bconvs[newId] = credentials[id];
        console.log(newId);
    }
    console.log("returning from bconv");
    return bconvs;
}

function db() {
    return when.promise(function(resolve,reject,notify) {
        if (!mongodb) {
            mongo.MongoClient.connect(settings.mongoUrl,
                {
                    db:{
                        retryMiliSeconds:1000,
                        numberOfRetries:3
                    },
                    server:{
                        poolSize:1,
                        auto_reconnect:true,
                        socketOptions:{
                            socketTimeoutMS:10000,
                            keepAlive:1
                        }
                    }
                },
                function(err,_db) {
                    if (err) {
                        util.log("Mongo DB error:"+err);
                        reject(err);
                    } else {
                        mongodb = _db;
                        resolve(_db);
                    }
                }
            );
        } else {
            resolve(mongodb);
        }
    });
}

function collection() {
    return when.promise(function(resolve,reject,notify) {
        db().then(function(db) {
            db.collection(settings.mongoCollection||"nodered",function(err,_collection) {
                if (err) {
                    util.log("Mongo DB error:"+err);
                    reject(err);
                } else {
                    resolve(_collection);
                }
            });
        }).otherwise(function (err) {
            reject(err);
        })
    });
}

function libCollection() {
    return when.promise(function(resolve,reject,notify) {
        db().then(function(db) {
            db.collection(settings.mongoCollection||"nodered"+"-lib",function(err,_collection) {
                if (err) {
                    util.log("Mongo DB error:"+err);
                    reject(err);
                } else {
                    resolve(_collection);
                }
            });
        }).otherwise(function (err) {
            reject(err);
        })
    });
}

function close() {
    return when.promise(function(resolve,reject,notify) {
        if (mongodb) {
            mongodb.close(true, function(err,result) {
                if (err) {
                    util.log("Mongo DB error:"+err);
                    reject(err);
                } else {
                    resolve();
                }
            })
            mongodb = null;
        }
    });
}

function timeoutWrap(func) {
    return when.promise(function(resolve,reject,notify) {
        var promise = func().timeout(5000,"timeout");
        promise.then(function(a,b,c,d) {
            //heartBeatLastSent = (new Date()).getTime();
            resolve(a,b,c,d);
        });
        promise.otherwise(function(err) {
            console.log("TIMEOUT: ",func.name);
            if (err == "timeout") {
                close().then(function() {
                    resolve(func());
                }).otherwise(function(err) {
                    reject(err);
                });
            } else {
                reject(err);
            }
        });
    });
}

function getFlows() {
    console.log("Getting flows");
    var defer = when.defer();
    collection().then(function(collection) {
        collection.find({appname:appname}, {
            sort: {
                $natural:-1
            },
            limit: 1
        }, function(err, doc) {
        // collection.find({appname:appname}).sort({$natural:-1}).limit(1).exec(function(err, doc) {
        // })
        // collection.findOne({appname:appname},function(err,doc) {
            doc = doc[0];
            if (err) {
                defer.reject(err);
            } else {
                if (doc && doc.flow) {
                    defer.resolve(doc.flow);
                } else {
                    defer.resolve([]);
                }
            }
        })
    }).otherwise(function(err) {
        defer.reject(err);
    });
    return defer.promise;
}

function saveFlows(flows) {
    console.log("saveFlows");
    var defer = when.defer();
    collection().then(function(collection) {
        collection.find({appname:appname}, {
            sort: {
                $natural:-1
            },
            limit: 1
        }, function(err, doc) {
            doc = doc[0];
            if (err) {
                console.log(err);
                defer.reject(err);
            } else {
                // defer.resolve();
                // doc.credentials = bconv(credentials);
                doc.appname = appname;
                doc.flow = flows;
                delete doc._id;
                collection.insert(doc, function(err, doc) {
                    if (err) {
                        console.log(err);
                        defer.reject(err);
                    } else {
                        defer.resolve();
                    }
                });
            }
        })
        // collection.update({appname:appname},{$set:{appname:appname,flow:flows}},{upsert:true},function(err) {
        //     if (err) {
        //         defer.reject(err);
        //     } else {
        //         defer.resolve();
        //     }
        // })
    }).otherwise(function(err) {
        defer.reject(err);
    });
    return defer.promise;
}

function getCredentials() {
    console.log("Get Credentials");    
    var defer = when.defer();
    collection().then(function(collection) {
        collection.find({appname:appname}, {
            sort: {
                $natural:-1
            },
            limit: 1
        }, function(err, doc) {
        // collection.findOne({appname:appname},function(err,doc) {
            doc = doc[0];
            if (err) {
                defer.reject(err);
            } else {
                if (doc && doc.credentials) {
                    defer.resolve(jconv(doc.credentials));
                } else {
                    defer.resolve({});
                }
            }
        })
    }).otherwise(function(err) {
        defer.reject(err);
    });
    return defer.promise;
}

function saveCredentials(credentials) {
    console.log("credentials are ", credentials);
    var defer = when.defer();
    collection().then(function(collection) {
        // collection.findOne({appname: appname}, function)
        collection.find({appname:appname}, {
            sort: {
                $natural:-1
            },
            limit: 1
        }, function(err, doc) {
            doc = doc[0];
            if (err) {
                console.log(err);
                defer.reject(err);
            } else {
                // defer.resolve();
                console.log("Saving Credentials");
                doc.credentials = bconv(credentials);
                delete doc._id;
                console.log(doc);
                collection.insert(doc, function(err, doc) {
                    if (err) {
                        console.log(err);
                        defer.reject(err);
                    } else {
                        defer.resolve();
                    }
                });
            }
        })
    }).otherwise(function(err) {
        defer.reject(err);
    });
    return defer.promise;
}

function getSettings () {
    console.log("Get Settings");
    var defer = when.defer();
    collection().then(function(collection) {
        collection.find({appname:appname}, {
            sort: {
                $natural:-1
            },
            limit: 1
        }, function(err, doc) {
        // collection.findOne({appname:appname},function(err,doc) {
            doc = doc[0];
            if (err) {
                defer.reject(err);
            } else {
                if (doc && doc.settings) {
                    defer.resolve(jconv(doc.settings));
                } else {
                    defer.resolve({});
                }
            }
        })
    }).otherwise(function(err) {
        defer.reject(err);
    });
    return defer.promise;
}

function saveSettings (settings) {
    var defer = when.defer();
    collection().then(function(collection) {
        collection.find({appname:appname}, {
            sort: {
                $natural:-1
            },
            limit: 1
        }, function(err, doc) {
            // doc = doc[0];
            if (err) {
                console.log(err);
                defer.reject(err);
            } else {
                // defer.resolve();
                // console.log("Saving settings in doc", doc);
                // var docObject = doc.toObject();
                var docObject = {};
                for (var key in doc) {
                    docObject[key] = doc[key];
                }
                docObject.settings = bconv(settings);
                delete docObject._id;
                console.log("doc before saving settings", docObject);

                // Copied over because of Rangeerror
                // see https://stackoverflow.com/questions/24466366/mongoose-rangeerror-maximum-call-stack-size-exceeded
                collection.insert(docObject, function(err, doc) {
                    console.log("Should have inserted doc");
                    if (err) {
                        console.log("errored out");
                        console.log(err);
                        defer.reject(err);
                    } else {
                        console.log("Resolved settings");
                        defer.resolve();
                    }
                });
            }
        })
    }).otherwise(function(err) {
        defer.reject(err);
    });
    return defer.promise;
}

function getAllFlows() {
    var defer = when.defer();
    libCollection().then(function(libCollection) {
        libCollection.find({appname:appname, type:'flow'},{sort:'path'}).toArray(function(err,docs) {
            if (err) {
                defer.reject(err);
            } else if (!docs) {
                defer.resolve({});
            } else {
                var result = {};
                for (var i=0;i<docs.length;i++) {
                    var doc = docs[i];
                    var path = doc.path;
                    var parts = path.split("/");
                    var ref = result;
                    for (var j=0;j<parts.length-1;j++) {
                        ref['d'] = ref['d']||{};
                        ref['d'][parts[j]] = ref['d'][parts[j]]||{};
                        ref = ref['d'][parts[j]];
                    }
                    ref['f'] = ref['f']||[];
                    ref['f'].push(parts.slice(-1)[0]);
                }
                defer.resolve(result);
            }
        });
    }).otherwise(function(err) {
        defer.reject(err);
    });
    return defer.promise;
}

function getFlow(fn) {
    var defer = when.defer();
    libCollection().then(function(libCollection) {
        libCollection.find({appname:appname, type: 'flow', path: fn}, {
            sort: {
                $natural:-1
            },
            limit: 1
        }, function(err, doc) {
            doc = doc[0];
        // libCollection.findOne({appname:appname, type:'flow', path:fn},function(err,doc) {
            if (err) {
                defer.reject(err);
            } else if (doc&& doc.data) {
                defer.resolve(doc.data);
            } else {
                defer.reject();
            }
        });
    }).otherwise(function(err) {
        defer.reject(err);
    });
    return defer.promise;
}

function saveFlow(fn,data) {
    var defer = when.defer();
    libCollection().then(function(libCollection) {
        libCollection.find({appname:appname, type: "flow", path: fn}, {
            sort: {
                $natural:-1
            },
            limit: 1
        }, function(err, doc) {
            doc = doc[0];
            // ).sort({$natural:-1}).limit(1).exec(function(err, doc) {
            if (err) {
                console.log(err);
                defer.reject(err);
            } else {
                // defer.resolve();
                doc.appname = appname;
                doc.type='flow';
                doc.path = fn;
                doc.data = data;
                delete doc._id;
                collection.insert(doc, function(err, doc) {
                    if (err) {
                        console.log(err);
                        defer.reject(err);
                    } else {
                        defer.resolve();
                    }
                });
            }
        })
        // libCollection.update({appname:appname,type:'flow',path:fn},{appname:appname,type:'flow',path:fn,data:data},{upsert:true},function(err) {
        //     if (err) {
        //         defer.reject(err);
        //     } else {
        //         defer.resolve();
        //     }
        // });
    }).otherwise(function(err) {
        defer.reject(err);
    });
    return defer.promise;
}

function getLibraryEntry(type,path) {
    var defer = when.defer();
    libCollection().then(function(libCollection) {        
        // libCollection.find({appname:appname, type: type, path: path}).sort({$natural:-1}).limit(1).exec(function(err, doc) {        
        // libCollection.findOne({appname:appname, type:type, path:path}, function(err,doc) {
        libCollection.find({appname:appname, type: type, path: path}, {
            sort: {
                $natural:-1
            },
            limit: 1
        }, function(err, doc) {
            doc = doc[0];
            if (err) {
                defer.reject(err);
            } else if (doc) {
                defer.resolve(doc.data);
            } else {
                if (path != "" && path.substr(-1) != "/") {
                    path = path+"/";
                }
                libCollection.find({appname:appname, type:type, path:{$regex:path+".*"}},{sort:'path'}).toArray(function(err,docs) {
                    if (err) {
                        defer.reject(err);
                    } else if (!docs) {
                        defer.reject("not found");
                    } else {
                        var dirs = [];
                        var files = [];
                        for (var i=0;i<docs.length;i++) {
                            var doc = docs[i];
                            var subpath = doc.path.substr(path.length);
                            var parts = subpath.split("/");
                            if (parts.length == 1) {
                                var meta = doc.meta;
                                meta.fn = parts[0];
                                files.push(meta);
                            } else if (dirs.indexOf(parts[0]) == -1) {
                                dirs.push(parts[0]);
                            }
                        }
                        defer.resolve(dirs.concat(files));
                    }
                });
            }
        });
    }).otherwise(function(err) {
        defer.reject(err);
    });
    return defer.promise;
}

function saveLibraryEntry(type,path,meta,body) {
    var defer = when.defer();
    libCollection().then(function(libCollection) {
        libCollection.find({appname:appname, type: type, path: path}, {
            sort: {
                $natural:-1
            },
            limit: 1
        }, function(err, doc) {
            doc = doc[0];
        // libCollection.find({appname:appname, type:type, path: path}).sort({$natural:-1}).limit(1).exec(function(err, doc) {
            doc.appname = appname;
            doc.type = type;
            doc.path = path;
            doc.meta = meta;
            doc.data = body;
            delete doc._id;
            collection.insert(doc, function(err, doc) {
        // libCollection.update({appname:appname,type:type,path:path},{appname:appname,type:type,path:path,meta:meta,data:body},{upsert:true},function(err) {
                if (err) {
                    defer.reject(err);
                } else {
                    defer.resolve();
                }
            });
        });
    }).otherwise(function(err) {
        defer.reject(err);
    });
    return defer.promise;
}

var mongostorage = {
    init: function(_settings) {
        console.log(_settings);
        settings = _settings;
        appname = settings.mongoAppname || require('os').hostname();
        return db();
    },
    getFlows: function() {
        return timeoutWrap(getFlows);
    },
    saveFlows: function(flows) {
        return timeoutWrap(function(){return saveFlows(flows);});
    },

    getCredentials: function() {
        return timeoutWrap(getCredentials);
    },

    saveCredentials: function(credentials) {
        return timeoutWrap(function(){return saveCredentials(credentials);});
    },

    getSettings: function() {
        return timeoutWrap(function() { return getSettings();});
    },

    saveSettings: function(data) {
        return timeoutWrap(function() { return saveSettings(data);});
    },

    getAllFlows: function() {
        return timeoutWrap(getAllFlows);
    },

    getFlow: function(fn) {
        return timeoutWrap(function() { return getFlow(fn);});
    },

    saveFlow: function(fn,data) {
        return timeoutWrap(function() { return saveFlow(fn,data);});
    },

    getLibraryEntry: function(type,path) {
        return timeoutWrap(function() { return getLibraryEntry(type,path);});
    },
    saveLibraryEntry: function(type,path,meta,body) {
        return timeoutWrap(function() { return saveLibraryEntry(type,path,meta,body);});
    }
};

module.exports = mongostorage;