.PHONY: all build-frontend build-backend run clean prod

# Variables
FRONTEND_DIR = frontend
BACKEND_DIR = .
PORT ?= 8080
OUTPUT_DIR = output

# Default target
all: build-frontend build-backend

# Frontend build
build-frontend:
	@echo "Building frontend..."
	cd $(FRONTEND_DIR) && npm install && npm run build

# Backend build
build-backend:
	@echo "Building backend..."
	go mod tidy
	go build -o webredis

# Production build
prod: clean build-frontend build-backend
	@echo "Creating production output..."
	@mkdir -p $(OUTPUT_DIR)
	@mkdir -p $(OUTPUT_DIR)/$(FRONTEND_DIR)
	@cp webredis $(OUTPUT_DIR)/
	@cp -r $(FRONTEND_DIR)/dist $(OUTPUT_DIR)/$(FRONTEND_DIR)/
	@cp -r data $(OUTPUT_DIR)/ 2>/dev/null || true
	@echo "Production build complete in $(OUTPUT_DIR) directory"

# Run the application
run: build-frontend build-backend
	@echo "Starting application on port $(PORT)..."
	PORT=$(PORT) ./webredis

# Development mode (with hot reload for frontend)
dev:
	@echo "Starting development mode..."
	cd $(FRONTEND_DIR) && npm run dev & \
	PORT=$(PORT) go run main.go db.go

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	rm -f webredis
	rm -rf $(OUTPUT_DIR)
	cd $(FRONTEND_DIR) && rm -rf dist node_modules

# Install dependencies
install:
	@echo "Installing dependencies..."
	cd $(FRONTEND_DIR) && npm install
	go mod tidy

# Run tests
test:
	@echo "Running tests..."
	go test ./...

# Help target
help:
	@echo "Available targets:"
	@echo "  all           - Build both frontend and backend (default)"
	@echo "  build-frontend - Build the frontend"
	@echo "  build-backend  - Build the backend"
	@echo "  prod          - Create production-ready output in $(OUTPUT_DIR)"
	@echo "  run           - Build and run the application"
	@echo "  dev           - Run in development mode with hot reload"
	@echo "  clean         - Remove build artifacts"
	@echo "  install       - Install all dependencies"
	@echo "  test          - Run tests"
	@echo "  help          - Show this help message" 