/**
  Mongoose Backend.
  Implementation of the storage backend using MongoDB with Mongoose driver
*/

var contract = require('./contract');
var async = require('async');
var _ = require('underscore');
var _s = require('underscore.string');

/**
 * Initialize ACL Collection in MongoDB with Mongoose schema
 */
function MongooseBackend(mongoose, prefix){
  this.mongoose = mongoose;
  this.prefix = typeof prefix !== 'undefined' ? prefix : '';

  // Schema definition
  var aclSchema = new this.mongoose.Schema({
    bucket: String,
    key: String,
    valueSet: [ String ]
  }, { safe: true });
  aclSchema.index({ bucket: 1, key: 1 });

  // Initialize ACL Model
  this.modelName = ( this.prefix === '' ) ? 'Acl' : _s.capitalize(_s.camelize(this.prefix + '_acl'));
  this.Acl = this.mongoose.model(this.modelName, aclSchema);
}

MongooseBackend.prototype = {
 /**
     Begins a transaction.
  */
  begin : function(){
    // returns a transaction object(just an array of functions will do here.)
    return [];
  },

  /**
     Ends a transaction (and executes it)
  */
  end : function(transaction, cb){
    contract(arguments).params('array', 'function').end();

    async.series(transaction,function(err){
      cb(err instanceof Error? err : undefined);
    });
  },

  /**
    Cleans the whole storage.
  */
  clean : function(cb){
    contract(arguments).params('function').end();
    var self = this;
    this.Acl.remove({}, function(err) {
      if (err) {
        return cb(err);
      }
      return cb();
    });
  },

  /**
     Gets the contents at the bucket's key.
  */
  get : function(bucket, key, cb){
    contract(arguments)
        .params('string', 'string', 'function')
        .end();

    this.Acl.findOne({
      bucket: bucket,
      key: key
    }, undefined, { lean: true }, function(err, acldoc) {
      if (err) {
        throw new Error(err);
      }
      if (acldoc !== null) {
        return cb(undefined, acldoc.valueSet);
      } else {
        return cb(undefined, []);
      }
    });
  },

  /**
    Returns the union of the values in the given keys.
  */
  union : function(bucket, keys, cb) {
    contract(arguments)
      .params('string', 'array', 'function')
      .end();

    this.Acl.aggregate([{
       $match: {
          bucket: bucket,
          key: { $in: keys }
        }
    }, {
      $unwind: '$valueSet'
    }, {
      $group: {
        _id: null,
        union: { $addToSet: '$valueSet' }
      }
    }], function (err, data) {
      if (err) {
        throw new Error(err);
      }
      if (typeof data !== 'undefined' &&
          Array.isArray(data) &&
          data.length &&
          typeof data[0].union !== 'undefined') {
        cb(undefined, data[0].union);
      } else {
        cb(undefined, []);
      }
    });
  },

  /**
    Adds values to a given key inside a bucket.
  */
  add : function(transaction, bucket, key, values) {
    contract(arguments)
        .params('array', 'string', 'string','string|array')
        .end();

    if(key=="key") throw new Error("Key name 'key' is not allowed.");
    var self=this;

    transaction.push(function(cb){
      values = makeArray(values);
      if (Array.isArray(key)) {
        if (key.length > 1) {
          throw new Error("Key should contain only a single value.");
        } else {
          key = key[0];
        }
      }

      self.Acl.findOneAndUpdate({
        bucket: bucket,
        key: key
      }, { }, { upsert: true }, function(err, acldoc) {
        if (err) {
          throw new Error(err);
        }
        var len = values.length;
        for ( var i = 0; i < len; i += 1 ) {
          acldoc.valueSet.addToSet(values[i]);
        }
        acldoc.save(function(err){
          if (err) {
            throw new Error(err);
          }
          cb();
        });
      });
    });
  },

  /**
     Delete the given key(s) at the bucket
  */
  del : function(transaction, bucket, keys){
    contract(arguments)
        .params('array', 'string', 'string|array')
        .end();

    keys = makeArray(keys);
    var self = this;

    transaction.push(function(cb){
      self.Acl.remove({ bucket: bucket, key: { $in: keys } }, function(err){
        cb(undefined);
      });
    });

  },

  /**
    Removes values from a given key inside a bucket.
  */
  remove : function(transaction, bucket, key, values){
    contract(arguments)
        .params('array', 'string', 'string','string|array')
        .end();
    values = makeArray(values);

    function removeFactory(Acl, bucket, key, values) {

      return function(callback) {

        Acl.findOneAndUpdate({
          bucket: bucket,
          key: key
        }, {
          $pullAll: { valueSet: values }
        }, function(err, acldoc) {
          if (err) {
            throw new Error(err);
          }

          callback(undefined);
        });
      };
    }

    transaction.push(removeFactory(this.Acl, bucket, key, values));
  }
};

function makeArray(arr){
  return Array.isArray(arr) ? arr : [arr];
}

exports = module.exports = MongooseBackend;
