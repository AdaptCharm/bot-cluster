var master = require('./master.js');

var dapi = {
    last_id: 1,
    queue: {},

    request: function(cmd, opt, cb) {
        var id = dapi.last_id++;
        dapi.queue[id] = cb;

        master.send('dapi_request', id, cmd, opt);
    },

    answer_received: function(seq, data, err) {
        if(!this.queue[seq]) return this.report('Received Dapi answer for unknown SEQ=' + seq + ', data=' + require('util').inspect(data) + ', err=' + err);
        this.queue[seq](data, err);
        delete this.queue[seq];
    }
};

dapi.NOTICE_CODE_VERSION_MISMATCH       = 0;
dapi.NOTICE_CODE_COMMUNICATION_ERROR    = 1;
dapi.NOTICE_CODE_AUTH_FAILED            = 2;
dapi.NOTICE_CODE_SUBSCRIPTION_NOT_FOUND = 3;

module.exports = dapi;