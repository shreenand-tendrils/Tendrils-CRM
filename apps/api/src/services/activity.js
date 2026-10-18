import {prisma} from '../db.js';import {hub} from '../realtime/hub.js';
export async function logActivity(data){try{await prisma.activityLog.create({data})}catch(e){console.error('Activity log failed:',e.message)}}
/** Saves the notification and pushes it live to the user's open tabs. */
export async function notifyUser(data){if(!data.userId)return;const n=await prisma.notification.create({data});hub.sendToUser(data.userId,{type:'notification',notification:n});return n}
