> [!NOTE]
> This project build by AI. Feel free to modify and use this tool

# WebRedis - Redis Web Management Interface

A modern web interface for managing Redis connections and data. Built with Go and React.

## Features

- Connect to local or remote Redis instances
- View and manage Redis databases
- Browse and search keys
- View and edit key values
- Support for different Redis data types (string, list, set, hash, zset)

## Prerequisites

- Go 1.21 or later
- Node.js 16 or later
- Redis server (local or remote)

## Backend Setup

1. Install Go dependencies:
```bash
go mod download
```

2. Run the backend server:
```bash
go run main.go
```

The server will start on port 8080 by default. You can change the port by setting the `PORT` environment variable.

## Frontend Setup

1. Navigate to the frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Build for production:
```bash
npm run build
```

## Usage

1. Open your browser and navigate to `http://localhost:8080`
2. Add a new Redis connection by providing:
   - Host (default: localhost)
   - Port (default: 6379)
   - Password (if required)
   - Database number
3. Once connected, you can:
   - Browse databases
   - View keys and their values
   - Add, edit, or delete keys
   - Switch between different Redis instances

## API Endpoints

- `POST /api/connections` - Create a new Redis connection
- `GET /api/connections` - List all connections
- `DELETE /api/connections/:id` - Delete a connection
- `GET /api/databases/:id` - List databases for a connection
- `GET /api/keys/:id/:db` - List keys in a database
- `GET /api/key/:id/:db/:key` - Get key value
- `POST /api/key/:id/:db/:key` - Set key value
- `DELETE /api/key/:id/:db/:key` - Delete key

## License

MIT 