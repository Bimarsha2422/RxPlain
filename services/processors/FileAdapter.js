import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import { existsSync } from 'fs';
import * as fs from 'fs';
import { storage } from '../../config/firebase-admin.js';

/**
 * Adapter class to handle file uploads and conversions
 * Helps bridge the gap between multer file objects and document models
 */
class FileAdapter {
  /**
   * Create document object from multer file
   * @param {Object} file - Multer file object
   * @param {string} userId - User ID
   * @returns {Object} - Document-like object
   */
  static createDocumentFromFile(file, userId) {
    if (!file) {
      throw new Error('No file provided');
    }
    
    return {
      fileName: file.originalname,
      fileType: file.mimetype,
      fileSize: file.size,
      buffer: file.buffer,
      userId
    };
  }
  
  /**
   * Get Firebase storage bucket
   * @returns {Object} - Firebase storage bucket
   */
  static getBucket() {
    return storage.bucket();
  }
  
  /**
   * Get file buffer from document
   * @param {Document|Object} document - Document model or file-like object
   * @returns {Promise<Buffer>} - File buffer
   */
  static async getFileBuffer(document) {
    // Handle direct file uploads (already have buffer)
    if (document.buffer) {
      return document.buffer;
    }
    
    // For a document from the DB, we'll need to download it from storage
    const tempFilePath = join(tmpdir(), `${uuidv4()}-${document.fileName}`);
    
    try {
      // Get the storage bucket
      const bucket = document.bucket || this.getBucket();
      const file = bucket.file(document.filePath);
      
      // Download file to temp location
      await file.download({ destination: tempFilePath });
      
      if (!existsSync(tempFilePath)) {
        throw new Error('Failed to download document to temporary location');
      }
      
      // Read file as buffer
      return fs.promises.readFile(tempFilePath);
    } catch (error) {
      console.error('Error getting file buffer:', error);
      throw error;
    } finally {
      // Clean up the temporary file
      if (existsSync(tempFilePath)) {
        try {
          await unlink(tempFilePath);
        } catch (err) {
          console.warn(`Failed to delete temporary file: ${err.message}`);
        }
      }
    }
  }
  
  /**
   * Convert document or file to base64
   * @param {Document|Object} documentOrFile - Document model or multer file
   * @returns {Promise<{base64Data: string, mimeType: string}>} - Base64 data
   */
  static async toBase64(documentOrFile) {
    // Handle basic file objects
    if (documentOrFile.buffer) {
      return {
        base64Data: documentOrFile.buffer.toString('base64'),
        mimeType: documentOrFile.fileType || documentOrFile.mimetype
      };
    }
    
    // Handle document models or other objects
    try {
      const buffer = await this.getFileBuffer(documentOrFile);
      const mimeType = documentOrFile.fileType || documentOrFile.mimetype;
      const base64Data = buffer.toString('base64');
      
      return { base64Data, mimeType };
    } catch (error) {
      console.error('Error converting to base64:', error);
      throw error;
    }
  }
}

export default FileAdapter; 