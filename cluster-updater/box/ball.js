var config = require('./config.js');

function Ball(task, ball_id) {
    //this.id      = ball_id;
    this.bot     = null;
    this.x       = 0;
    this.y       = 0;
    this.size    = 0;
    this.updated = (+new Date);

    task.balls[ball_id] = this;
}

Ball.prototype.destroy = function(task, ball_id) {
    if(this.bot) {
        var pos = this.bot.my_balls.indexOf(ball_id);
        if(pos >= 0) {
            var bot = this.bot;
            this.bot.my_balls.splice(pos, 1);
            if(!bot.my_balls.length && !bot.spawn_attempt) {
                if(config.debug >= 7)
                    bot.log.info('LOST ALL BALLS! RESPAWNING!');
                bot.spawn();
            }
        }

    }
    delete task.balls[ball_id];
};

Ball.prototype.update = function() {
    this.updated = (+new Date);
};



module.exports = Ball;