var config = require('./config.js');
var Logger  = require('./logger.js');
var mysql  = require('mysql');
var log = new Logger('db');

module.exports.init = function(cb) {
    log.info('Initializing');

    var pool  = mysql.createPool(config.db);

    pool.query('SELECT VERSION() as `ver`, USER() as `user`', function(err, rows) {
        if (err) {
            log.error('Failed to initialize: ' + err);
            throw err;
        }

        log.info('Successfully connected to MySQL version ' + log.colorize(39, false, true, rows[0]['ver']) + ' as ' + log.colorize(39, false, true, rows[0]['user']));
        module.exports = pool;

        cb();
    });
};