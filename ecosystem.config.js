module.exports = {
  apps: [
    {
      name: 'eddva-backend',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      max_memory_restart: '500M',
      restart_delay: 3000,
      max_restarts: 10,
      watch: false,
      error_file: '/home/ubuntu/logs/eddva-backend-error.log',
      out_file: '/home/ubuntu/logs/eddva-backend-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
