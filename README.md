# WebRedis - Redis Web Interface

WebRedis is a web-based interface for managing Redis databases. This package contains everything needed to run the application. I build this with AI

## Prerequisites

- Redis server running and accessible
- Port 8080 available (or configure a different port)

## Quick Start

1. Start the application:
   ```bash
   ./webredis
   ```

2. Access the web interface at: http://localhost:8080

## Configuration

### Environment Variables

- `PORT`: Set the port number (default: 8080)
  ```bash
  PORT=3000 ./webredis
  ```

### Data Storage

- Redis connections are stored in `data/connections.db`
- The database is automatically created on first run
- Make sure the `data` directory is writable

## Features

- Connect to multiple Redis servers
- Browse and manage Redis databases
- View and edit key values
- Set TTL (Time To Live) for keys
- Execute custom Redis commands
- Persistent connection storage

## Security Notes

1. By default, the application runs in debug mode. For production:
   ```bash
   GIN_MODE=release ./webredis
   ```

2. The application trusts all proxies by default. For production, set trusted proxies:
   ```bash
   TRUSTED_PROXIES=127.0.0.1,::1 ./webredis
   ```

## Troubleshooting

1. If the application fails to start:
   - Check if the port is already in use
   - Ensure Redis server is running
   - Verify file permissions

2. If connections are not saved:
   - Check if the `data` directory is writable
   - Verify SQLite database permissions

## License

This software is provided as-is under the MIT License.

## Support

For issues and feature requests, please visit the project repository. 