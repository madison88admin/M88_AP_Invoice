import multer from 'multer';
import path from 'path';

const storage = multer.memoryStorage();

const fileFilter = (req: any, file: any, cb: any) => {
  const allowedTypes = /jpeg|jpg|png|pdf|xml|ubl/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  // Only check extension for now, mimetype can be unreliable
  if (extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only images, PDF, XML, and UBL invoice files are allowed'));
  }
};

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter,
});

export default upload;
