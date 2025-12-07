# Woe Frontend

A modern, feature-rich frontend for the Gotify server, built with Vue 3, TypeScript, and Scoped CSS.

## Features

### Core Functionality
- **Dashboard**: Overview of system status, recent messages, and statistics
- **Messages**: Real-time message viewing with pagination, filtering, and batch operations
- **Applications**: Manage applications with icon support and detailed views
- **Clients**: Client management with token handling
- **Users**: User management with role-based access control
- **Plugins**: Complete plugin system with configuration and display support

### Enhanced Features
- **Real-time Updates**: WebSocket integration with connection status indicators
- **Application Icons**: Upload and manage application icons
- **Message Filtering**: Filter by application, priority, and search terms
- **Batch Operations**: Select and delete multiple messages at once
- **Plugin Management**: Enable/disable plugins and configure via YAML
- **Responsive Design**: Mobile-friendly interface with adaptive layouts
- **Error Handling**: Global error notification system with user-friendly messages
- **Loading States**: Consistent loading indicators and skeleton screens
- **Empty States**: Helpful empty state displays with action prompts

## Technical Stack

- **Framework**: Vue 3 with Composition API
- **Language**: TypeScript
- **State Management**: Pinia
- **Routing**: Vue Router
- **HTTP Client**: Axios
- **Build Tool**: Vite
- **Testing**: Vitest
- **Styling**: Scoped CSS with custom design system

## Project Structure

```
src/
├── components/          # Reusable UI components
│   ├── ApplicationIcon.vue
│   ├── ConnectionStatus.vue
│   ├── EmptyState.vue
│   ├── Layout.vue
│   ├── LoadingSpinner.vue
│   ├── MessageFilters.vue
│   └── Notification.vue
├── services/           # API and external services
│   ├── api.ts
│   ├── auth.ts
│   └── websocket.ts
├── stores/             # Pinia state management
│   ├── auth.ts
│   └── messages.ts
├── types/              # TypeScript type definitions
│   └── index.ts
├── utils/              # Utility functions
│   └── errorHandler.ts
├── views/              # Page components
│   ├── ApplicationDetail.vue
│   ├── Applications.vue
│   ├── Clients.vue
│   ├── Dashboard.vue
│   ├── Login.vue
│   ├── Messages.vue
│   ├── PluginDetail.vue
│   ├── Plugins.vue
│   ├── Setup.vue
│   └── Users.vue
├── router/
│   └── index.ts
├── App.vue
└── main.ts
```

## Getting Started

### Prerequisites
- Node.js 16+ 
- npm or yarn
- Gotify server instance

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd woe/frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:

   For development, copy the development environment file:
   ```bash
   cp .env.development .env.local
   # Edit .env.local with your configuration
   ```

   For production, use:
   ```bash
   cp .env.production .env.local
   # Edit .env.local with your production configuration
   ```

4. Start development server:
   ```bash
   npm run dev
   ```

5. Build for production:
   ```bash
   npm run build
   ```

### Environment Variables

- `VITE_API_BASE_URL`: Base URL for API requests (default: `/`)
- `VITE_AUTH_ENCRYPTION_KEY`: Key for encrypting authentication data

## API Integration

The frontend integrates with the Gotify server REST API:

- Authentication via Basic Auth
- Message management with pagination
- Application and client management
- Plugin configuration and display
- Real-time updates via WebSocket

## Testing

Testing infrastructure is planned for future releases. Currently, manual testing is recommended.

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## License

This project is licensed under the GPLv3 License.