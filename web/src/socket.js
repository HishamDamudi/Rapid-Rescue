import { io } from 'socket.io-client';
export const SOCKET_URL = 'http://localhost:5000';

let socket = null;
export function connectSocket() {
  if (socket?.connected) return socket;
  const token = localStorage.getItem('token');
  socket = io(SOCKET_URL, { auth: { token } });
  return socket;
}
export function getSocket() { return socket; }
