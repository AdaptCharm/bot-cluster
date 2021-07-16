var config = require('./config.js');
var Box = require('./box.js');
//var db = require('./db.js');
var reception = require('./reception.js');
var wapi = require('./wapi.js');
var Logger  = require('./logger.js');
var Dapi  = require('./dapi.js');

var log = new Logger('master');


log.info('Waiting for reception server');

reception.init(log, function() {
    log.info('Reception is ready');
    wapi.init(function() {
        log.info('Wapi webserver is ready');
        Box.init(function() {
            log.info('Box socket is listening');
            log.info(log.colorize(32, true, true, 'Master is ready!'));


            var last = (+new Date);
            setInterval(function() {
                var current = (+new Date);
                var delta = current-last;
                last = current;
                var dapi = new Dapi('TICK');
                dapi.process('tick', {time: delta}, function(data, err) {
                    if(err) log.warn('Dapi tick error: ' + err);
                });
            }, config.master.dapi_tick_interval);


        });
    });
});



