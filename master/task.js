var Logger = require('./logger.js');
var config = require('./config.js');
var Dapi = require('./dapi.js');
var reception = require('./reception.js');
var crypto = require('crypto');

function Task(subscription, box, customer) {
    this.id             = 'TASK/SUB/' + subscription.id + '/CUSTOMER/' + customer.uid;
    this.box            = box;
    this.customer       = customer;
    this.subscription   = subscription;
    this.log            = new Logger(this.id);
    this.connected      = 0;
    this.destroyed      = false;

    this.subscription.task = this;
    this.subscription.engaged_by = customer;

    if(box.tasks[this.id]) throw new Error('Attempted to insert task ' + this.id + ' in box, but there is one already');
    box.tasks[this.id] = this;

    this.customer.send('engaged', subscription.id, true);
    this.customer.broadcast('engaged', subscription.id, false);

    if(config.master.debug >= 1)
        this.log.info('Task is created');
}

Task.prototype.engage = function(task_opt) {
    this.proxies        = task_opt.proxy;
    this.leaders        = task_opt.leaders;
    this.region         = task_opt.region;
    this.server         = task_opt.server;
    this.key            = task_opt.key;
    this.nickname       = task_opt.nickname;
    this.dataproxy_ip   = task_opt.dataproxy_ip;
    this.dataproxy_port = task_opt.dataproxy_port;

    if(config.master.debug >= 1)
        this.log.info('preparing to launch on ' + this.box.id);

    if(!this.subscription.activated) this.activateSubscription();

    this.engageOnRemote();
};

/*Task.prototype.send = function() {
    var arr = ['task_message', ''];
    for(var i=0;i<arguments.length;i++) arr.push(arguments[i]);
    var json = JSON.stringify(arr);

    if(this.debug >= 4)
        this.log.info('SEND: ' + json);

    if(this.killed) {
        if(this.debug >= 2)
            this.log.warn('Socket is killed, SEND aborted');
        return;
    }

    this.socket.write(json + '\n');
};*/

Task.prototype.activateSubscription = function() {
    var task = this;
    var dapi = new Dapi(this.id);
    dapi.process('subscription_activate', {id: this.subscription.id}, function(data, err) {
        if(err || !data || !data.status || data.status == 'error' || data.status != 'success') {
            task.log.error('Failed to subscription_activate id=' + task.subscription.id + ', got data=' + JSON.stringify(data) + ', err=' + err);
            task.customer.send('notice', 16);
            task.disengage();
            return;
        }
        task.subscription.activated = true;
        task.subscription.expire = (+new Date) + task.subscription.remain*1000;

        task.customer.send('activated', task.subscription.id);
        task.customer.broadcast('activated', task.subscription.id);
    });
};

Task.prototype.engageOnRemote = function() {
    this.box.send('engage', {
        id: this.id,
        proxies: this.proxies,
        type: this.subscription.type,
        count: this.subscription.count,
        remain: this.subscription.remain,
        region: this.region,
        leaders: this.leaders,
        key: this.key,
        server: this.server,
        nickname: this.nickname,
        dataproxy_ip: this.dataproxy_ip,
        dataproxy_port: this.dataproxy_port
    });
};

Task.prototype.disengage = function() {
    this.destroyed = true;
    this.box.send('disengage', this.id);
};

Task.prototype.disengaged = function() {
    this.subscription.engaged_by = null;
    this.subscription.task = null;
    this.destroyed = true;
    this.remove();

    this.customer.send('disengaged', this.subscription.id);
    this.customer.broadcast('disengaged', this.subscription.id);
};

Task.prototype.remove = function() {
    delete this.box.tasks[this.id];
};

//from box to task
Task.prototype.box_processors = {
    engaged: function() {
        if(config.master.debug >= 1)
            this.log.info('Box reporting that task is engaged');

        if(this.destroyed) {
            if(config.master.debug >= 1)
                this.log.info('Box reporting that task is engaged, but master says it is destroyed already, sendind command to box');
            this.disengage();
        }
    },

    disengaged: function() {
        if(config.master.debug >= 1)
            this.log.info('Box reporting that task is disengaged');

        this.disengaged();
    },

    notice_customer: function(code) {
        this.customer.send('notice', code);
    },

    connected: function(count) {
        this.connected = count;
        this.customer.send('connected', this.subscription.id, count);
        this.customer.broadcast('connected', this.subscription.id, count);
    },

    activated: function() {
        if(config.master.debug >= 1)
            this.log.info('Box reporting that task is activated');

        this.subscription.activated = true;
        this.subscription.expire = this.subscription.remain*1000 + (+new Date);

        this.customer.send('activated', this.subscription.id);
        this.customer.broadcast('activated', this.subscription.id);
    }
};



module.exports = Task;