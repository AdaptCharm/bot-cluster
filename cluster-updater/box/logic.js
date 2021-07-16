var Point = require('./point.js');
var config = require('./config.js');

Logic.tick = function(task) {
    for(var i=0;i<task.bots.length;i++) {
        var bot = task.bots[i];
        new Logic(bot, task);
    }
};

function Logic(bot, task) {
    this.ball = bot;
    this.point = new Point(this.ball.x, this.ball.y);
    this.task = task;
    var target = new Point(this.task.target_x, this.task.target_y);
    this.angle_to_target = this.point.calculateAngle(target);

    var safest_point = null;
    var safest_angle = this.findSafestAngle();

    if(safest_angle) {
        safest_point = this.point.calculatePointByAngleAndDistance(safest_angle, config.logic.move_distance);
    }else{
        safest_point = target;
    }

    bot.moveTo(safest_point.x, safest_point.y);
}

Logic.prototype.findSafestAngle = function() {
    var safest_angle = null;
    for(var i=0;i<config.logic.probes.length;i++) {
        var probe_angle = this.probeSafestAngle(config.logic.probes[i]);

        if(probe_angle) {
            safest_angle = probe_angle;
            break;
        }
    }
    return safest_angle;
};

Logic.prototype.probeSafestAngle = function(probe) {
    var angle = 0+this.angle_to_target;
    var point = this.point.calculatePointByAngleAndDistance(angle, probe.search_distance);
    if(this.isSafePoint(point, probe)) return angle;

    var half_fov = probe.search_fov / 2;
    var part_fov = half_fov / (probe.search_looks-1);

    for(var i=1;i<probe.search_looks;i++) {
        var angle_a = part_fov*i;
        var point_a = this.point.calculatePointByAngleAndDistance(angle_a+this.angle_to_target, probe.search_distance);
        var is_safest_a = this.isSafePoint(point_a, probe);
        if(is_safest_a) return angle_a+this.angle_to_target;

        var angle_b = -angle_a;
        var point_b = this.point.calculatePointByAngleAndDistance(angle_b+this.angle_to_target, probe.search_distance);
        var is_safest_b = this.isSafePoint(point_b, probe);
        if(is_safest_b) return angle_b+this.angle_to_target;
    }

    return null;
};

Logic.prototype.isSafePoint = function(point, probe) {
    for(var ball_id in this.task.balls) {
        if(!this.task.balls.hasOwnProperty(ball_id)) continue;
        var ball = this.task.balls[ball_id];
        if(ball.bot) continue;
        if(ball.friend) continue;

        var enemy_point = new Point(ball.x, ball.y);
        var distance_to_point = enemy_point.calculateDistance(point)-ball.size/2-probe.search_point_range;

        if((distance_to_point) <= 0) return false;
    }

    return true;
};



module.exports = Logic;