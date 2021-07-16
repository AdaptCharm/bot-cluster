module.exports = {
    version: 5, // Version of extension to check
    debug: 5,

    //master reception config
    client: {
        host:   '127.0.0.1', // Master IP
        port: 58000,         // Master reception port
        password: 'biS$MTARyQNATIp0$LRyT((2c[)Qo2z999' // Master reception password
    },

    //reception server config
    server: {
        host: '0.0.0.0',
        port: 8080,
        engine: { // engine.io config https://github.com/socketio/engine.io#methods-1
            pingTimeout: 60*1000,
            pingInterval: 25*1000,
            maxHttpBufferSize: 2*1024,
            path: '/server'
        }
    }
};
