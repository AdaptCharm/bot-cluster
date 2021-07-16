var Logger  = require('./logger.js');
var config = require('./config.js');
var net = require('net');

function DataProxy(opt) {
    this.log = new Logger('DATAPROXY/PORT' + opt.task.dataproxy_port + '/' + opt.task.id);
    this.task = opt.task;
    this.port = opt.task.dataproxy_port;
    this.server = null;
    this.clients = [];

    this.startServer();
}

DataProxy.prototype.startServer = function() {
    var dataproxy = this;
    this.server = net.createServer(function(socket) {
        if(config.debug >= 1)
            dataproxy.log.info('Received new connection from ' + socket.remote);

        dataproxy.clients.push(socket);

        socket.on('error', dataproxy.on_socket_error.bind(dataproxy, socket));
        socket.on('data', dataproxy.on_socket_data.bind(dataproxy, socket));
        socket.on('close', dataproxy.on_socket_close.bind(dataproxy, socket, socket.remoteAddress, socket.remotePort));
    });

    this.server.on('listening', function() {
        if(config.debug >= 1)
            dataproxy.log.info('Ready on port ' + dataproxy.port);

        if(dataproxy.task.destroyed) dataproxy.destroy();
    });

    this.server.on('error', function(e) {
        if(config.debug >= 1)
            dataproxy.log.error('Failed to open port ' + dataproxy.port + ' error:\r\n' + e + '\r\n' + e.stack);
        dataproxy.task.send('notice_customer', 19);
        dataproxy.task.destroy();
    });

    this.server.listen(this.task.dataproxy_port, '0.0.0.0');
};

DataProxy.prototype.destroy = function() {
    if(config.debug >= 1)
        this.log.info('Destroying');

    this.server.close();

    for(var key in this.clients) {
        if(!this.clients.hasOwnProperty(key)) continue;
        this.clients[key].end();
    }
};

DataProxy.prototype.on_socket_error = function(socket, err) {
    if(config.debug >= 1)
        this.log.warn('Socket ' + socket.remoteAddress + ':' + socket.remotePort + ' error: ' + err + '\n' + err.stack);

};

DataProxy.prototype.on_socket_close = function(socket, socket_ip, socket_port) {
    if(config.debug >= 1)
        this.log.info('Socket ' + socket_ip + ':' + socket_port + ' disconnected');

    var index = this.clients.indexOf(socket);
    if(index >= 0) this.clients.splice(index, 1);
};


DataProxy.prototype.on_socket_data = function(socket, data) {
    if(config.debug >= 10)
        this.log.info('Data received from socket ' + socket.remoteAddress + ':' + socket.remotePort + ': ' + data.toString('hex'));

    if(!data || data.length < 2) return;

    var type = data.readInt8(0);
    var packet_id = data.readInt8(1);
    var processor = (type == 19 ? 'in' : 'out') + packet_id;

    if(!this.processors[processor]) return;
    try{
        this.processors[processor].call(this, data);
    }catch(e){
        if(config.debug >= 1)
            this.log.warn('Processor ' + processor + '  error on data ' + data.toString('hex') + ':\r\n' + e + '\r\n' + e.stack);
    }
};

DataProxy.prototype.processors = {
    'in16': function(packet) {
        if(this.task.customer_offset_x) return;

        var offset = 2;
        //var bot = this;
        //var now = (+new Date);

        var eaters_count = packet.readUInt16LE(offset);
        offset += 2;

        //bot.tick_counter++;

        offset += eaters_count*8;
        //reading eat events
        /*for(var i=0;i<eaters_count;i++) {
         var eater_id = packet.readUInt32LE();
         var eaten_id = packet.readUInt32LE();

         if(config.debug >= 9)
         bot.log.info(eater_id + ' ate ' + eaten_id + ' (' + bot.task.balls[eater_id] + '>' + bot.task.balls[eaten_id] + ')');

         if(bot.task.balls[eater_id]) bot.task.balls[eater_id].update();
         if(bot.task.balls[eaten_id]) bot.task.balls[eaten_id].destroy(this.task, eaten_id);
         }*/


        //reading actions of balls
        while(1) {
            var is_virus = false;
            var ball_id;
            var coordinate_x;
            var coordinate_y;
            //var size;
            //var color;
            //var nick = null;

            ball_id = packet.readUInt32LE(offset);
            offset += 4;
            if(ball_id == 0) break;
            coordinate_x = packet.readInt32LE(offset);
            offset += 4;
            coordinate_y = packet.readInt32LE(offset);
            offset += 4;
            //size = packet.readSInt16LE();

            offset += 5;
            /*var color_R = packet.readUInt8();
             var color_G = packet.readUInt8();
             var color_B = packet.readUInt8();

             color = (color_R << 16 | color_G << 8 | color_B).toString(16);
             color = '#' + ('000000' + color).substr(-6);*/

            var opt = packet.readUInt8(offset);
            offset += 1;
            is_virus = !!(opt & 1);
            //var something_1 = !!(opt & 16); //what is this?

            //reserved for future use?
            if (opt & 2) {
                offset += packet.readUInt32LE(offset);
                offset += 4;
            }
            if (opt & 4) {
                //var something_2 = ''; //something related to premium skins
                while(1) {
                    var char = packet.readUInt8(offset);
                    offset += 1;
                    if(char == 0) break;
                    /*if(!something_2) something_2 = '';
                     something_2 += String.fromCharCode(char);*/
                }
            }

            var nick = '';
            while(1) {
                char = packet.readUInt16LE(offset);
                offset += 2;
                if(char == 0) break;
                if(!nick) nick = '';
                nick += String.fromCharCode(char);
            }


            if(nick && this.task.known_balls[nick]) {
                var bot = this.task.known_balls[nick];
                if(!bot.offset_x || !bot.x) continue;
                this.task.customer_offset_x = coordinate_x - (bot.x - bot.offset_x);
                this.task.customer_offset_y = coordinate_y - (bot.y - bot.offset_y);
                //console.log('------SET OFFSET TO: ', this.task.customer_offset_x, this.task.customer_offset_y);
            }
        }
    },

    'in64': function(packet) {
        var offset = 2;
        var min_x = packet.readDoubleLE(offset);
        offset += 8;
        var min_y = packet.readDoubleLE(offset);
        offset += 8;
        var max_x = packet.readDoubleLE(offset);
        offset += 8;
        var max_y = packet.readDoubleLE(offset);
        offset += 8;

        if((max_x - min_x) >= 14000 && (max_y - min_y) >= 14000) {
            this.task.customer_offset_x = min_x;
            this.task.customer_offset_y = min_y;
        }
    },

    'out16': function(packet) {
        if(!this.task.customer_offset_x) return;

        var offset = 2;
        var x     = packet.readInt32LE(offset);
        offset += 4;
        var y     = packet.readInt32LE(offset);
        offset += 4;

        this.task.target_x = x - this.task.customer_offset_x;
        this.task.target_y = y - this.task.customer_offset_y;

        //console.log('----mouse taget: ' + this.task.target_x + ', ' + this.task.target_y);
    }
};


module.exports = DataProxy;