import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { env } from '../config/env.js';
import { requirePermission, canSeeOrg } from '../middleware/index.js';
import { AppError } from '../errors/AppError.js';
const router = Router();
const dir = path.resolve(env.uploadDir, 'documents'); fs.mkdirSync(dir, { recursive: true });
const allowedExt = new Set(['.pdf','.doc','.docx','.xls','.xlsx','.csv','.ppt','.pptx','.txt','.md','.png','.jpg','.jpeg','.webp']);
const upload = multer({ storage: multer.diskStorage({ destination: dir, filename: (_r,_f,cb)=>cb(null,crypto.randomUUID()) }), limits: { fileSize: env.maxUploadBytes }, fileFilter: (_r,f,cb)=>allowedExt.has(path.extname(f.originalname).toLowerCase()) ? cb(null,true) : cb(new Error('Unsupported document format')) });
router.get('/documents', async (req,res)=>{
 const memberships = (req.memberships || []).filter(m=>m.isActive); const orgIds = memberships.map(m=>m.organizationId);
 const rows = await prisma.document.findMany({ where: { OR: [{ visibility:'INTERNAL', organizationId:null, ...(req.isInternal ? {} : { id:'__none__' }) }, { organizationId:{ in:orgIds }, ...(req.isInternal ? {} : { visibility:'CLIENT' }) }] }, orderBy:{createdAt:'desc'}, take:200, include:{uploadedBy:{select:{id:true,name:true,email:true}},organization:{select:{id:true,name:true,type:true}}} });
 res.json(rows);
});
router.post('/documents', requirePermission('file.upload'), upload.single('file'), async(req,res)=>{
 if(!req.file) throw new AppError('Choose a file',400);
 const organizationId = req.body.organizationId || null; const visibility = req.body.visibility === 'CLIENT' ? 'CLIENT' : 'INTERNAL';
 if(organizationId){ const ok=(req.memberships||[]).some(m=>m.isActive && m.organizationId===organizationId); if(!ok){ await fs.promises.unlink(req.file.path).catch(()=>{}); throw new AppError('You do not have access to this client',403); } }
 if(!req.isInternal && visibility!=='CLIENT'){ await fs.promises.unlink(req.file.path).catch(()=>{}); throw new AppError('Client users can only upload client-visible documents',403); }
 const originalName=path.basename(req.file.originalname).slice(0,255);
 const row=await prisma.document.create({data:{title:String(req.body.title||originalName).slice(0,180),originalName,storageKey:req.file.filename,mimeType:req.file.mimetype,size:req.file.size,category:String(req.body.category||'GENERAL').slice(0,40),visibility,organizationId,uploadedById:req.currentUser.id},include:{uploadedBy:{select:{id:true,name:true,email:true}},organization:{select:{id:true,name:true,type:true}}}}); res.status(201).json(row);
});
router.get('/documents/:id/download', async(req,res)=>{
 const d=await prisma.document.findUnique({where:{id:req.params.id},include:{organization:true}}); if(!d) throw new AppError('Document not found',404);
 const member=(req.memberships||[]).some(m=>m.isActive && m.organizationId===d.organizationId); const allowed=d.visibility==='INTERNAL' ? !!req.isInternal && (!d.organizationId || member) : (!!req.isInternal || member);
 if(!allowed) throw new AppError('Document not found',404); const file=path.join(dir,path.basename(d.storageKey)); if(!fs.existsSync(file)) throw new AppError('Document not found',404); res.download(file,d.originalName);
});
export default router;
