var Logger  = require('./logger.js');
var config = require('./config.js');
var Coordinator = require('./coordinator.js');

function GPS(opt) {
    this.task = opt.task;
    this.coordinators = [];
    this.known_balls = {};
}

GPS.prototype.bestCandidate = function(ball_name) {
    /*var candidate = null;
    var candidate_coordinator = null;
    for(var i=0;i<this.coordinators.length;i++) {
        var coordinator = this.coordinators[i];
        var ball = this.known_balls[ball_name];
        if(!ball) continue;
        if(
            ( !candidate )
        ||
            ( !candidate.visible && ball.visible )
        ||
            ( ball.visible && ball.last_update > candidate.last_update )
        ||
            ( !ball.visible && !candidate.visible && ball.last_update > candidate.last_update )
        ) {
            candidate = ball;
            candidate_coordinator = coordinator;
        }
    }

    if(!candidate) return null;
    return {ball: candidate, coordinator: candidate_coordinator};*/

    var ball = this.known_balls[ball_name];
    if(ball) {
        return {ball: ball, coordinator: ball.coordinator};
    }
};

GPS.prototype.locate = function(bot, coordinator, ball) {
    if(bot && !bot.ball_nickname) return;
    if(!coordinator) {
        var candidate = this.bestCandidate(bot.ball_nickname);
        if(!candidate) return;
        coordinator = candidate.coordinator;
        ball = candidate.ball;
    }
    if(!ball.name) return;

    if(bot.offset_x === null && bot.x !== null) {
        //bot.offset_x = (ball.x-coordinator.offset_x) - bot.x;
        //bot.offset_y = (ball.y-coordinator.offset_y) - bot.y;
        bot.offset_x = bot.x - (ball.x-coordinator.offset_x);
        bot.offset_y = bot.y - (ball.y-coordinator.offset_y);
    }

    var now = (+new Date);
    if(now-bot.last_tick > config.remote.tick_interval) {
        bot.moveTo(this.task.target_x, this.task.target_y);
        bot.last_tick = now;
    }
};

/*GPS.prototype.ballAppeared = function(ball, coordinator) {
    for(var i=0;i<this.task.bots.length;i++) {
        var bot = this.task.bots[i];
        if(bot.ball_nickname == ball.nick) {
            if(bot.offset_x) return;
            return this.locate(bot, coordinator, ball);
        }
    }
};*/

GPS.prototype.ballAppeared = function(ball, coordinator) {
    var bot = this.task.known_balls[ball.name];
    if(!bot) return;
    if(bot.offset_x) return;

    this.locate(bot, coordinator, ball);
};

GPS.prototype.engage = function(opt) {
    this.coordinators.push(new Coordinator(opt));
};

module.exports = GPS;
