SOURCE=/opt/cluster-updater/box/

if [ -f $SOURCE/config.js ]; then
    mv $SOURCE/config.js $SOURCE/config.js.example
fi

rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@37.139.14.199::box
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@37.139.14.111::box
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@37.139.14.90::box
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@37.139.14.55::box
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@37.139.14.210::box
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@37.139.13.185::box
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@37.139.13.225::box
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@37.139.13.35::box
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@37.139.13.30::box
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@198.211.113.57::box
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@198.211.113.56::box
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@198.211.113.53::box
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@198.211.113.52::box
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@198.211.113.50::box
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@198.211.110.135::box
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@198.211.110.129::box
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@198.211.110.227::box
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@198.211.103.122::box
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@198.211.107.228::box
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@82.196.3.241::box
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@178.238.224.209::box
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@5.189.132.188::box
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@5.189.134.31::box 
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@5.189.138.67::box
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@5.189.166.171::box
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@84.200.84.181::box
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@84.200.2.37::box
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@82.211.30.246::box
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@82.211.30.25::box
rsync --password-file=rsync_pass -az /opt/cluster-updater/box/ boxer0@82.211.30.43::box