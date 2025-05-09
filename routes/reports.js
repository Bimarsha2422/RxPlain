import express from 'express';
import { isAuthenticated } from '../middleware/auth.js';
import admin from 'firebase-admin';

const router = express.Router();

// Get all reports for a user
router.get('/', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.uid;
    const db = admin.firestore();
    
    console.log(`[Reports API] Fetching reports for user: ${userId}`);
    
    // Query the reports collection for this user
    const snapshot = await db.collection('reports')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();
    
    const reports = [];
    snapshot.forEach(doc => {
      const reportData = doc.data();
      
      // Format timestamps for the frontend
      const formattedReport = {
        ...reportData,
        createdAt: reportData.createdAt && reportData.createdAt.toDate ? 
                  reportData.createdAt.toDate().toISOString() : 
                  new Date().toISOString(),
        updatedAt: reportData.updatedAt && reportData.updatedAt.toDate ? 
                  reportData.updatedAt.toDate().toISOString() : 
                  new Date().toISOString()
      };
      
      reports.push(formattedReport);
    });
    
    console.log(`[Reports API] Returning ${reports.length} reports for user ${userId}`);
    
    return res.status(200).json({
      success: true,
      reports: reports
    });
    
  } catch (error) {
    console.error('Error fetching reports:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to fetch reports' 
    });
  }
});

// Get a specific report by ID
router.get('/:reportId', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { reportId } = req.params;
    const db = admin.firestore();
    
    console.log(`[Reports API] Fetching report ${reportId} for user: ${userId}`);
    
    const reportRef = db.collection('reports').doc(reportId);
    const reportDoc = await reportRef.get();
    
    if (!reportDoc.exists) {
      return res.status(404).json({ 
        success: false, 
        error: 'Report not found' 
      });
    }
    
    const reportData = reportDoc.data();
    
    // Check if the report belongs to the user
    if (reportData.userId !== userId) {
      return res.status(403).json({ 
        success: false, 
        error: 'Not authorized to access this report' 
      });
    }
    
    // Format timestamps for the frontend
    const formattedReport = {
      ...reportData,
      createdAt: reportData.createdAt && reportData.createdAt.toDate ? 
                reportData.createdAt.toDate().toISOString() : 
                new Date().toISOString(),
      updatedAt: reportData.updatedAt && reportData.updatedAt.toDate ? 
                reportData.updatedAt.toDate().toISOString() : 
                new Date().toISOString()
    };
    
    return res.status(200).json({
      success: true,
      report: formattedReport
    });
    
  } catch (error) {
    console.error('Error fetching report:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to fetch report' 
    });
  }
});

// Delete a report
router.delete('/:reportId', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { reportId } = req.params;
    const db = admin.firestore();
    
    console.log(`[Reports API] Deleting report ${reportId} for user: ${userId}`);
    
    const reportRef = db.collection('reports').doc(reportId);
    const reportDoc = await reportRef.get();
    
    if (!reportDoc.exists) {
      return res.status(404).json({ 
        success: false, 
        error: 'Report not found' 
      });
    }
    
    const reportData = reportDoc.data();
    
    // Check if the report belongs to the user
    if (reportData.userId !== userId) {
      return res.status(403).json({ 
        success: false, 
        error: 'Not authorized to delete this report' 
      });
    }
    
    // Delete the report
    await reportRef.delete();
    
    // Remove the report reference from the user document
    await db.collection('users').doc(userId).update({
      reports: admin.firestore.FieldValue.arrayRemove(reportId)
    });
    
    return res.status(200).json({
      success: true,
      message: 'Report deleted successfully'
    });
    
  } catch (error) {
    console.error('Error deleting report:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to delete report' 
    });
  }
});

// Update a report
router.put('/:reportId', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { reportId } = req.params;
    const { title } = req.body;
    const db = admin.firestore();
    
    if (!title) {
      return res.status(400).json({ 
        success: false, 
        error: 'Title is required' 
      });
    }
    
    console.log(`[Reports API] Updating report ${reportId} for user: ${userId}`);
    
    const reportRef = db.collection('reports').doc(reportId);
    const reportDoc = await reportRef.get();
    
    if (!reportDoc.exists) {
      return res.status(404).json({ 
        success: false, 
        error: 'Report not found' 
      });
    }
    
    const reportData = reportDoc.data();
    
    // Check if the report belongs to the user
    if (reportData.userId !== userId) {
      return res.status(403).json({ 
        success: false, 
        error: 'Not authorized to update this report' 
      });
    }
    
    // Update the report
    await reportRef.update({
      title,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    return res.status(200).json({
      success: true,
      message: 'Report updated successfully'
    });
    
  } catch (error) {
    console.error('Error updating report:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to update report' 
    });
  }
});

export default router; 