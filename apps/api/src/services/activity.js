import {prisma} from '../db.js';import {hub} from '../realtime/hub.js';import {deliverWhatsApp} from './whatsapp/notify.js';
export async function logActivity(data){try{await prisma.activityLog.create({data})}catch(e){console.error('Activity log failed:',e.message)}}
/** Saves the notification, pushes it live to the user's open tabs, and mirrors it to WhatsApp when the user linked it. */
export async function notifyUser(data){if(!data.userId)return;const n=await prisma.notification.create({data});hub.sendToUser(data.userId,{type:'notification',notification:n});deliverWhatsApp(n).catch(e=>console.error('[wa] notify failed:',e.message));return n}
