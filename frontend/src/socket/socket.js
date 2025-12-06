import { io } from 'socket.io-client';

const socket = io('https://mesa-compras-production.up.railway.app', {
  transports: ['websocket'], // ← mejora compatibilidad con Railway
  withCredentials: true
});

export default socket;
