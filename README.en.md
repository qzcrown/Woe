# Woe

Woe is a Gotify-compatible notification service built on Cloudflare Workers, providing simple and reliable push notification services.

## Features

- 🚀 Built on Cloudflare Workers, global deployment, auto-scaling
- 📱 Gotify v2.0.2 compatible, supports existing clients
- 🔐 Flexible authentication mechanisms, supports multiple token types
- 📨 Real-time message push, WebSocket support
- 🔌 Plugin system for functionality extension
- 📊 Complete RESTful API
- 🖼️ Image storage support (Cloudflare R2)
- 🌐 **New Web UI Interface** - Modern management interface based on Vue 3

## Quick Start

### Prerequisites

Before starting deployment, ensure you have the following ready:

1. **Cloudflare Account** - For deploying Workers, creating D1 databases and R2 buckets
2. **Node.js 18+** - For running build scripts and Wrangler CLI
3. **Wrangler CLI** - Cloudflare Workers command-line tool
4. **Git** - For cloning the code repository

### Deployment Guide

Woe supports two deployment methods: direct deployment from the original repository, or deployment after forking to your own account.

#### Method 1: Direct Deployment from Original Repository

If you just want to quickly try Woe, you can deploy directly from the original repository:

```bash
# 1. Clone the repository
git clone https://github.com/qzcrown/woe.git
cd woe

# 2. Install dependencies
npm install
npm run setup:frontend  # Install frontend dependencies

# 3. Log in to Cloudflare (if not already logged in)
wrangler login

# 4. Create Cloudflare resources
# Create D1 database
wrangler d1 create woe-db

# Create R2 bucket
wrangler r2 bucket create woe-storage

# 5. Configure the project
# Copy example configuration file
cp example.wrangler.toml wrangler.toml

# Edit wrangler.toml, update the following configurations:
# - database_id: Obtain from step 4 output
# - bucket_name: Can be customized or use default value
# - Route configuration (if using custom domain)

# 6. Build frontend
npm run build:frontend

# 7. Deploy to Cloudflare Workers
npm run deploy
```

#### Method 2: Fork and Deploy (Recommended for Production Environment)

If you plan to use Woe long-term or customize it, it's recommended to fork the repository to your own GitHub account before deployment:

1. **Fork the Repository**
   - Visit https://github.com/qzcrown/woe
   - Click the "Fork" button in the top right corner to create your own copy

2. **Clone Your Fork**
   ```bash
   git clone https://github.com/your-username/woe.git
   cd woe
   ```

3. **Install Dependencies**
   ```bash
   npm install
   npm run setup:frontend
   ```

4. **Configure Cloudflare Resources**
   ```bash
   # Log in to Cloudflare (using your account)
   wrangler login

   # Create D1 database (name can be customized)
   wrangler d1 create woe-db

   # Create R2 bucket (name can be customized)
   wrangler r2 bucket create woe-storage
   ```

5. **Update Configuration File**
   ```bash
   # Copy example configuration
   cp example.wrangler.toml wrangler.toml

   # Edit wrangler.toml, must modify the following configurations:
   # - database_id: Replace with the database ID created in step 4
   # - database_name: Can keep default or customize
   # - bucket_name: Can keep default or customize
   # - Route configuration: If using custom domain, update pattern field
   # - Environment variables: Recommended to modify default admin password
   ```

6. **Build and Deploy**
   ```bash
   # Build frontend
   npm run build:frontend

   # Deploy to Cloudflare Workers
   npm run deploy
   ```

#### Verify Successful Deployment

After deployment, verify through the following methods:

1. **Access Worker Domain**
   ```
   https://your-worker-name.your-account.workers.dev/
   ```
   Or your custom domain.

2. **Use Default Credentials to Login**
   - Username: `admin`
   - Password: `password`
   - **Important**: Change the default password immediately after login!

3. **Check System Status**
   ```bash
   # Check health status
   curl https://your-domain/health

   # Check version information
   curl https://your-domain/version
   ```

### Detailed Configuration Guide

Woe uses `wrangler.toml` as the main configuration file. The following are detailed explanations of key configuration items:

#### Cloudflare Resource Configuration

##### D1 Database Configuration
```toml
[[d1_databases]]
binding = "DB"  # Binding name used in code
database_name = "woe-db"  # Database display name
database_id = "your-database-id"  # MUST modify: Run `wrangler d1 create woe-db` to obtain
```

##### R2 Bucket Configuration
```toml
[[r2_buckets]]
binding = "R2"  # Binding name used in code
bucket_name = "woe-storage"  # Bucket name, can be customized
```

#### Route Configuration

##### Using workers.dev Domain
```toml
workers_dev = true  # Enable workers.dev domain
```

##### Using Custom Domain
```toml
workers_dev = false  # Disable workers.dev domain

[[routes]]
pattern = "your-domain.com"  # Your custom domain
custom_domain = true
```

#### Environment Variables Configuration
```toml
[vars]
ENVIRONMENT = "production"  # Environment identifier: development, production
VERSION = "1.0.0"  # Version number
DEFAULT_ADMIN_USER = "admin"  # Initial login username
DEFAULT_ADMIN_PASSWORD = "password"  # Initial login password (Change immediately after deployment!)
REGISTRATION = false  # Whether to open user registration, recommended false for production
```

#### Static Assets Binding
```toml
[assets]
directory = "./public"  # Frontend build output directory
binding = "ASSETS"  # Binding name used in code
```

#### Configuration Items That Must Be Modified After Fork

If you forked the repository, you must modify the following configurations:

1. **`database_id`** - Replace with your own created D1 database ID
2. **`bucket_name`** - Can be customized or use your created R2 bucket name
3. **Route configuration** - Update to your own domain or workers.dev domain
4. **Environment variables** - Especially `DEFAULT_ADMIN_PASSWORD`, recommended to use strong password

#### Automated Deployment Script Example

Create `deploy.sh` script to simplify deployment after forking:

```bash
#!/bin/bash
# deploy.sh - Woe automated deployment script after forking

set -e  # Exit immediately on error

echo "🚀 Starting Woe deployment..."

# Check dependencies
command -v wrangler >/dev/null 2>&1 || {
    echo "❌ Please install wrangler first: npm install -g wrangler"
    exit 1
}

# Log in to Cloudflare (if not already logged in)
echo "🔑 Checking Cloudflare login status..."
wrangler whoami || {
    echo "Please log in to Cloudflare..."
    wrangler login
}

# Create D1 database
echo "🗄️  Creating D1 database..."
DB_INFO=$(wrangler d1 create woe-db)
DATABASE_ID=$(echo "$DB_INFO" | grep -o 'database_id: "[^"]*"' | cut -d'"' -f2)

# Create R2 bucket
echo "📦 Creating R2 bucket..."
wrangler r2 bucket create woe-storage

# Update configuration file
echo "⚙️  Updating configuration file..."
cp example.wrangler.toml wrangler.toml
sed -i "s/database_id = \".*\"/database_id = \"$DATABASE_ID\"/" wrangler.toml

echo "✅ Configuration completed!"
echo "📝 Please check the wrangler.toml file and modify other configurations as needed."
echo "🚀 Run the following commands to complete deployment:"
echo "   npm run build:frontend"
echo "   npm run deploy"
```

### Troubleshooting

#### Common Issues

##### Q1: Deployment fails, showing database connection error
- **Cause**: `database_id` configuration incorrect or database doesn't exist
- **Solution**:
  1. Run `wrangler d1 list` to view database list
  2. Confirm `database_id` in `wrangler.toml` is correct
  3. Check if database belongs to currently logged in Cloudflare account

##### Q2: Frontend resources fail to load, showing 404 error
- **Cause**: Frontend not built or build files in incorrect location
- **Solution**:
  1. Confirm `npm run build:frontend` has been executed
  2. Check if `public` directory has build files
  3. Verify `[assets]` configuration in `wrangler.toml`

##### Q3: Cannot login, showing authentication failure
- **Cause**: Default admin credentials incorrect or database not initialized
- **Solution**:
  1. Confirm using correct default credentials: `admin` / `password`
  2. View Worker logs: `wrangler tail`
  3. Check if database migration executed successfully

##### Q4: Custom domain inaccessible
- **Cause**: DNS configuration incorrect or route configuration error
- **Solution**:
  1. Confirm CNAME record pointing to Workers has been added in Cloudflare DNS
  2. Check route configuration in `wrangler.toml`
  3. Run `wrangler deployments` to view latest deployment status

#### Log Viewing
```bash
# View real-time logs
wrangler tail

# View logs for specific time period
wrangler tail --format=json

# View error logs
wrangler tail | grep -i error
```

#### Debugging Tips
1. **Local development testing**: First test locally using `npm run dev`
2. **Step-by-step verification**: Verify each step according to deployment process
3. **Environment variable check**: Confirm all required environment variables are correctly set
4. **Database migration status**: Check if database table structure created correctly

### Multi-language Support

Woe frontend interface supports multi-language switching, currently includes:

- **Simplified Chinese (zh-CN)** - Default language
- **English (en-US)** - Fallback language

#### Language Switching Methods
1. **Automatic detection**: Automatically selects based on browser language settings
2. **Manual switching**: Select preferred language in Web UI settings
3. **Persistent storage**: Selected language saved in local storage

#### Contribute Translations for Your Language
Welcome to add more language support for Woe! Translation files located at:
```
frontend/src/locales/
├── zh-CN.ts  # Simplified Chinese
└── en-US.ts  # English
```

### Basic Usage

#### 1. Initial Login and Setup

After deployment, the system automatically creates a default administrator account:

**Default Administrator Credentials:**
- Username: `admin`
- Password: `password`

**Web UI Login:**
1. Access `https://your-worker-domain.workers.dev/`
2. Login with `admin:password`
3. After login, it's recommended to change the default password immediately

**API Authentication:**
```bash
# Use default administrator credentials for API authentication
curl -u "admin:password" \
  -X GET https://your-domain.workers.dev/api/v1/current/user
```

#### 2. Creating Applications

```bash
# 1. Create client token
CLIENT_RESPONSE=$(curl -s -u "admin:password" \
  -X POST https://your-domain.workers.dev/client \
  -H "Content-Type: application/json" \
  -d '{"name": "My First Client"}')

CLIENT_TOKEN=$(echo $CLIENT_RESPONSE | jq -r '.token')

# 2. Use client token to create application
curl -X POST https://your-domain.workers.dev/application \
  -H "Content-Type: application/json" \
  -H "X-Gotify-Key: $CLIENT_TOKEN" \
  -d '{"name": "My App", "description": "Test Application"}'
```

#### 3. Sending Messages

```bash
curl -X POST https://your-domain.workers.dev/message \
  -H "Content-Type: application/json" \
  -H "X-Gotify-Key: your-app-token" \
  -d '{"title": "Hello", "message": "World", "priority": 5}'
```

## Documentation

### API Documentation
- [API Overview](docs/api/README.md) - API usage guide and quick start
- [Authentication Mechanism](docs/api/authentication.md) - Detailed authentication explanation
- [OpenAPI Specification](docs/api/openapi.yaml) - Complete API specification

### Endpoint Documentation
- [System Endpoints](docs/api/endpoints/system.md) - Health check, version information, WebSocket
- [User Management](docs/api/endpoints/users.md) - User creation, update, deletion
- [Application Management](docs/api/endpoints/applications.md) - Application and token management
- [Client Management](docs/api/endpoints/clients.md) - Client device management
- [Message Management](docs/api/endpoints/messages.md) - Message sending and receiving
- [Plugin Management](docs/api/endpoints/plugins.md) - Plugin configuration and management
- [WebSocket Stream](docs/api/endpoints/websocket.md) - Real-time message push

### Development Documentation
- [Deployment Guide](#deployment-guide) - Detailed deployment instructions (within this document)
- [Development Plan](docs/gotify-cloudflare-worker-dev-plan.md) - Development planning and design

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Client Apps   │────│  Cloudflare     │────│   App Servers   │
│                 │    │    Workers      │    │                 │
│ • Mobile Apps   │    │                 │    │ • Monitoring    │
│ • Desktop       │    │ • RESTful API   │    │   Scripts       │
│   Clients       │    │ • WebSocket     │    │ • CI/CD Tools   │
│ • Web Interface │    │ • Authentication│    │ • Automated     │
│                 │    │   & Authorization│    │   Tasks        │
└─────────────────┘    │ • Message       │    └─────────────────┘
                       │   Routing       │
                       └─────────────────┘
                              │
                       ┌─────────────────┐
                       │  Cloudflare     │
                       │  D1 + R2        │
                       │                 │
                       │ • User Data     │
                       │ • Message       │
                       │   Storage       │
                       │ • Image Files   │
                       └─────────────────┘
```

## Authentication Mechanism

Woe supports multiple authentication methods:

- **Application Token (appToken)** - Used for sending messages
- **Client Token (clientToken)** - Used for receiving messages and management
- **Basic Auth** - Used for initial setup

Authentication methods:
- Header: `X-Gotify-Key: your-token`
- Bearer: `Authorization: Bearer your-token`
- Query parameter: `?token=your-token`

## Message Priority

| Priority | Level | Description |
|----------|-------|-------------|
| 0-2 | Low | Informational messages |
| 3-5 | Medium | Notification messages |
| 6-8 | High | Warning messages |
| 9-10 | Urgent | Critical messages |

## Client Support

### Official Clients
- [Gotify Android](https://github.com/gotify/android)
- [Gotify iOS](https://github.com/gotify/ios)

### Third-party Clients
- [Gotify CLI](https://github.com/gotify/cli)
- [Various Language Libraries](https://gotify.net/docs/libraries)

## Web UI Interface

Woe now includes a modern Web management interface based on Vue 3, providing the following features:

### Main Features

- **🏠 Dashboard** - System overview, real-time statistics, recent messages
- **📨 Message Management** - Real-time message viewing, deletion, WebSocket real-time updates
- **👥 User Management** - User creation, editing, deletion (administrator function)
- **📱 Application Management** - Application creation, token management, priority settings
- **💻 Client Management** - Client device management, token copying
- **🔐 Authentication System** - Secure login, session management

### Access Web UI

After deployment, access your Worker domain to open the Web UI:
```
https://your-worker-domain.workers.dev/
```

### Local Web UI Development

```bash
# Frontend development mode (hot reload)
npm run dev:frontend

# Backend development mode
npm run dev
```

## Development

### Local Development

1. Install dependencies
```bash
npm install
npm run setup:frontend  # Install frontend dependencies
```

2. Configure local environment
```bash
cp example.wrangler.toml wrangler.toml
# Edit wrangler.toml to configure database and storage
```

3. Local running
```bash
# Development mode (backend only)
npm run dev

# Run both frontend and backend simultaneously
npm run dev:frontend  # Terminal 1 - Frontend development server
npm run dev           # Terminal 2 - Backend Worker
```

### Build and Deployment

```bash
# Build frontend
npm run build:frontend

# Deploy
npm run deploy
```

### Contribution

Welcome to submit Issues and Pull Requests!

## License

[GPL License](LICENSE)

## Related Links

- [Gotify Official Website](https://gotify.net/)
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Project GitHub](https://github.com/qzcrown/woe)
