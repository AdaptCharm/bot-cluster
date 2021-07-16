var Customer = require('./customer.js');
var master = require('./master.js');

master.init(function() {
    Customer.init();
});