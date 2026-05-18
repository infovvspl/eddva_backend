module.exports = {
  apps: [
    {
      name: 'apexiq-backend',
      script: 'dist/main.js',
      cwd: '/home/ubuntu/apexiq-backend',

      // Keep 2 instances in cluster mode for zero-downtime restarts
      instances: 2,
      exec_mode: 'cluster',

      // Auto-restart on crash
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',

      // Environment
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },

      // Logging
      out_file: '/home/ubuntu/logs/apexiq-out.log',
      error_file: '/home/ubuntu/logs/apexiq-err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 10000,
      shutdown_with_message: true,
    },
  ],
};
