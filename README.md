# AdAlchemyAI

AdAlchemyAI is a full-stack application that automates Google Ads campaigns for small businesses using AI technology.

## Overview

- **Frontend**: React, TypeScript, Vite
- **Backend**: Node.js, Express

## Features

- AI-powered Google Ads campaign creation and optimization
- Interactive chat interface for user onboarding
- Dynamic FAQ section
- Discord bot integration for ongoing management

## Quick Start

### Frontend

1. Navigate to the `frontend` directory
2. Run `npm install`
3. Start the dev server: `npm run dev`

### Backend

1. Navigate to the `backend` directory
2. Run `npm install`
3. Set up environment variables (see `.env.example`)
4. Start the server: `npm start`

## Project Structure

- `/frontend`: React application
- `/backend`: Node.js server
- `/discord-bot`: Discord bot integration (if separate)

## API Endpoints

- `POST /startSession`: Initiates a new user session
- `POST /sendMessage`: Handles user-bot interactions
- `POST /endSession`: Concludes a user session
