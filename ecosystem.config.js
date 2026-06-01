// ecosystem.config.js
// Rooted Predictions — PM2 process manager configuration
// Usage: pm2 start ecosystem.config.js --env production
// Install log rotation: pm2 install pm2-logrotate

module.exports = {
  apps: [
    {
      name:        'rootedpredictions',
      script:      'server.js',
      instances:   'max',        // all available CPU cores
      exec_mode:   'cluster',    // cluster mode for load balancing

      env: {
        NODE_ENV: 'development',
        PORT:     3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT:     3000,
      },

      // Logs
      out_file:        './logs/out.log',
      error_file:      './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:      true,       // merge cluster instance logs into one file

      // Reliability
      watch:               false,  // never watch in production — use redeploy.sh
      max_memory_restart:  '512M', // restart if RSS exceeds 512 MB
      restart_delay:       5000,   // wait 5s between restart attempts
      max_restarts:        10,
      min_uptime:          '10s',  // must stay up 10s to count as "started"

      // Graceful shutdown (gives in-flight requests time to finish)
      kill_timeout:        5000,
      wait_ready:          false,
      listen_timeout:      10000,
    },
  ],
};
