function Point(x, y) {
    this.x = x;
    this.y = y;
}

Point.prototype.calculateAngle = function(target) {
    var res = Math.atan2(this.y - target.y, this.x - target.x) / Math.PI * 180;
    return (res < 0) ? res + 360 : res;
};

Point.prototype.calculateDistance = function(target) {
    var xdiff = target.x - this.x;
    var ydiff = target.y - this.y;
    return Math.pow((xdiff * xdiff + ydiff * ydiff), 0.5);
};

Point.prototype.calculatePointByAngleAndDistance = function(angle, distance) {
    angle = (angle - 180) * Math.PI / 180;
    var x1 = this.x + (Math.cos(angle) * distance);
    var y1 = this.y + (Math.sin(angle) * distance);
    return new Point(x1, y1);
};

Point.prototype.toString = function() {
  return '[Point ' + this.x + ', ' + this.y + ']';
};

module.exports = Point;
