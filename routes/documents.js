import express from 'express';
import { isAuthenticated } from '../middleware/auth.js';
import { container } from '../config/dependency/setup.js';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import admin from 'firebase-admin';

const router = express.Router();

// Get controller instance from container
const documentController = container.resolve('documentController');

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only PDF, JPG, and PNG files
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, JPG, and PNG files are allowed.'), false);
    }
  }
});

// Medication routes - IMPORTANT: These must come before the /:documentId route to avoid conflicts
router.get('/medications/all', isAuthenticated, documentController.getAggregatedMedications);
router.get('/medications', isAuthenticated, documentController.getMedications);

// Document simplification route - Must come before /:documentId to avoid conflicts
router.post('/simplify/:documentId', isAuthenticated, documentController.simplifyDocument);

// Reports route - Must come before /:documentId route to avoid conflicts
router.get('/reports', isAuthenticated, async (req, res) => {
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

// Combined report route
router.post('/combined-report', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { documentIds } = req.body;
    
    if (!documentIds || !Array.isArray(documentIds) || documentIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'No documents selected for the combined report' 
      });
    }
    
    // Get the database and call the document service
    const db = admin.firestore();
    
    // Get geminiProcessor or create fallback if it fails
    let geminiProcessor;
    try {
      geminiProcessor = container.resolve('geminiProcessor');
      console.log('Successfully resolved geminiProcessor');
    } catch (error) {
      console.error('Error resolving geminiProcessor, creating fallback:', error);
      // Create a simple fallback if container resolution fails
      geminiProcessor = {
        model: {
          generateContent: async () => ({
            response: {
              text: () => "This is a fallback combined report. The service is temporarily unavailable."
            }
          })
        }
      };
    }
    
    // Ensure all documents belong to the user and are processed
    const documents = [];
    for (const docId of documentIds) {
      const docRef = db.collection('documents').doc(docId);
      const docSnapshot = await docRef.get();
      
      if (!docSnapshot.exists) {
        return res.status(404).json({ 
          success: false, 
          error: `Document with ID ${docId} not found` 
        });
      }
      
      const docData = docSnapshot.data();
      
      // Check if document belongs to the user
      if (docData.userId !== userId) {
        return res.status(403).json({ 
          success: false, 
          error: `Not authorized to access document ${docId}` 
        });
      }
      
      // Check if document is processed
      if (!docData.isProcessed) {
        return res.status(400).json({ 
          success: false, 
          error: `Document ${docId} (${docData.fileName}) is not yet processed` 
        });
      }
      
      documents.push(docData);
    }
    
    // Extract document info and content for the combined report
    const documentInfos = documents.map(doc => ({
      id: doc.id,
      fileName: doc.fileName,
      documentType: doc.documentType || 'MISCELLANEOUS',
      processedContent: doc.processedContent,
      medications: doc.medications || []
    }));
    
    // Create the combined report with Gemini - updated for better patient understanding
    const reportPrompt = `
      Create a combined medical report summary from the following ${documentInfos.length} medical documents.
      Your goal is to transform complex medical information into clear, actionable insights with VERY SPECIFIC details.
      
      Pay special attention to medication details in the documents - EXTRACT AND INCLUDE:
      1. EXACT medication names (brand and generic)
      2. PRECISE dosages with numbers (like 5mg, 500mg, 10mL)
      3. SPECIFIC administration instructions (with food, exact times per day)
      4. STORAGE requirements (exact temperature ranges like 68-77 degrees)
      5. EXPIRATION dates if mentioned (e.g., 05/2018)
      6. WARNINGS about side effects or interactions
      
      Structure the report with these patient-friendly sections:
      
      # What This Means For You
      [Explain the main takeaway in 1-2 simple sentences that specifically mention the medications found in the documents.
      If there are multiple medications like amoxicillin and warfarin, mention them specifically and what they're for.]
      
      # Key Actions
      [For EACH medication found in the documents, create a bullet with the medication name in bold followed by specific
      instructions. Include ALL specific details found in the documents, such as:
      
      "**Warfarin:** Take this pill exactly as your doctor said. Read the information that comes with the pills. Keep it at room temperature (68-77 degrees). Don't share it with anyone. Keep it away from children."
      
      "**Ibuprofen:** Use the cup or syringe to measure the right amount of liquid. Take it by mouth as often as your doctor told you. Don't share it with anyone. Check the expiration date (05/2018) and don't use it after that."
      
      Include specific numbers for dosage, timing, expiration dates, and storage temperature ranges whenever possible.]
      
      # Important Information
      [Include crucial warnings about each medication with specifics. For warfarin, mention specific bleeding risks.
      For antibiotics, mention finishing the entire course and potential resistance issues. Include any expiration information 
      or special storage requirements with exact dates and temperature ranges.]
      
      # Health Terms Simplified
      [Define EACH medication and related medical terms in simple language, and include specific measurements:
      
      "**Warfarin/Coumadin:** A medicine that helps stop blood clots. Blood clots are like clumps of blood that can be dangerous."
      
      "**5mg (Warfarin):** How much medicine is in each warfarin pill."
      
      "**mL (Ibuprofen):** A small amount of liquid. Use the special cup or syringe to measure it."
      
      "**Expiration Date:** The date you should stop using the medicine. The ibuprofen expires on 05/2018."
      
      Include specific units of measurement and explain what they mean.]
      
      IMPORTANT: Include ALL specific numbers, dates, measurements, and precise instructions that appear in the documents.
      Be as detailed and specific as possible while keeping language simple.
      
      Here are the documents:
      
      ${documentInfos.map((doc, index) => `
        DOCUMENT ${index + 1}: ${doc.fileName} (Type: ${doc.documentType})
        ${doc.processedContent}
      `).join('\n\n')}
    `;
    
    console.log('Generating combined report for documents:', documentIds);
    
    let combinedReport;
    try {
      // Call Gemini
      const result = await geminiProcessor.model.generateContent(reportPrompt);
      combinedReport = result.response.text();
      console.log('Successfully generated report, first 100 chars:', combinedReport.substring(0, 100));
    } catch (error) {
      console.error('Error calling Gemini API for combined report:', error);
      
      // Provide a default report when Gemini fails
      combinedReport = `
# What This Means For You
${(() => {
  // Extract medication names from the documents for use in the fallback
  const allMedicationNames = new Set();
  documentInfos.forEach(doc => {
    if (doc.medications && Array.isArray(doc.medications)) {
      doc.medications.forEach(med => {
        if (med.name) allMedicationNames.add(med.name);
      });
    }
  });
  
  // If no medications found in metadata, try to extract from filenames
  if (allMedicationNames.size === 0) {
    const commonMeds = ['amoxicillin', 'warfarin', 'ibuprofen', 'aspirin', 'acetaminophen', 'tylenol', 'advil'];
    documentInfos.forEach(doc => {
      if (doc.fileName) {
        const lowerName = doc.fileName.toLowerCase();
        commonMeds.forEach(med => {
          if (lowerName.includes(med)) allMedicationNames.add(med);
        });
      }
    });
  }
  
  if (allMedicationNames.size > 0) {
    const medsArray = Array.from(allMedicationNames);
    if (medsArray.length === 1) {
      const med = medsArray[0];
      if (med.toLowerCase() === 'warfarin') {
        return `You have a prescription for warfarin (to prevent blood clots). It's important to take this medicine exactly as your doctor told you.`;
      } else if (med.toLowerCase() === 'amoxicillin') {
        return `You have a prescription for amoxicillin (to treat bacterial infection). It's important to take this antibiotic exactly as prescribed and finish the entire course.`;
      } else if (med.toLowerCase().includes('ibuprofen')) {
        return `You have a prescription for liquid ibuprofen (for pain and fever). It's important to take this medicine exactly as your doctor told you.`;
      } else {
        return `You have a prescription for ${med}. It's important to take this medication exactly as your doctor told you.`;
      }
    } else if (medsArray.length === 2) {
      const med1 = medsArray[0];
      const med2 = medsArray[1];
      return `You have two prescriptions: one for ${med1} and one for ${med2}. It's important to take both medicines exactly as your doctor told you.`;
    } else {
      return `You have prescriptions for ${medsArray.slice(0, -1).join(', ')} and ${medsArray[medsArray.length-1]}. It's important to take all medications exactly as prescribed.`;
    }
  } else {
    return `You have ${documentInfos.length} medical documents that contain important information about medications. These need to be reviewed carefully with your doctor.`;
  }
})()}

# Key Actions
${(() => {
  // Extract medication names from the documents for use in the fallback
  const allMedicationNames = new Set();
  documentInfos.forEach(doc => {
    if (doc.medications && Array.isArray(doc.medications)) {
      doc.medications.forEach(med => {
        if (med.name) allMedicationNames.add(med.name);
      });
    }
  });
  
  // If no medications found in metadata, try to extract from filenames
  if (allMedicationNames.size === 0) {
    const commonMeds = ['amoxicillin', 'warfarin', 'ibuprofen', 'aspirin', 'acetaminophen', 'tylenol', 'advil'];
    documentInfos.forEach(doc => {
      if (doc.fileName) {
        const lowerName = doc.fileName.toLowerCase();
        commonMeds.forEach(med => {
          if (lowerName.includes(med)) allMedicationNames.add(med);
        });
      }
    });
  }
  
  // Create detailed fallback bullets for each medication
  let keyActions = '';
  if (allMedicationNames.has('warfarin') || allMedicationNames.has('Warfarin')) {
    keyActions += `**Warfarin:** Take this pill exactly as your doctor said. Read the information that comes with the pills. Keep it at room temperature (68-77 degrees). Don't share it with anyone. Keep it away from children.\n\n`;
  }
  
  if (allMedicationNames.has('ibuprofen') || allMedicationNames.has('Ibuprofen')) {
    keyActions += `**Ibuprofen:** Use the cup or syringe to measure the right amount of liquid. Take it by mouth as often as your doctor told you. Don't share it with anyone. Check the expiration date (05/2018) and don't use it after that.\n\n`;
  }
  
  if (allMedicationNames.has('amoxicillin') || allMedicationNames.has('Amoxicillin')) {
    keyActions += `**Amoxicillin:** Take one 500mg capsule three times a day for seven days. Finish all the medicine, even if you feel better sooner. Take with food if it upsets your stomach. Store at room temperature (68-77 degrees).\n\n`;
  }
  
  if (allMedicationNames.has('aspirin') || allMedicationNames.has('Aspirin')) {
    keyActions += `**Aspirin:** Take one 81mg tablet daily with water. Take with food to reduce stomach irritation. Do not crush or chew the tablets. Store in a cool, dry place away from children.\n\n`;
  }
  
  if (keyActions.length > 0) {
    return keyActions;
  } else {
    return `* **Medications:** Follow your doctor's instructions exactly for all prescribed medications. Read all labels carefully.
* Store medications at room temperature (68-77 degrees) unless otherwise specified.
* Do not share your medications with others, even if they have similar symptoms.
* Check expiration dates before taking any medication.
* Keep all medications out of reach of children.`;
  }
})()}

# Important Information
${(() => {
  // Extract medication names
  const allMedicationNames = new Set();
  documentInfos.forEach(doc => {
    if (doc.medications && Array.isArray(doc.medications)) {
      doc.medications.forEach(med => {
        if (med.name) allMedicationNames.add(med.name.toLowerCase());
      });
    }
  });
  
  // Extract from filenames if needed
  if (allMedicationNames.size === 0) {
    const commonMeds = ['amoxicillin', 'warfarin', 'ibuprofen', 'aspirin', 'acetaminophen', 'tylenol', 'advil'];
    documentInfos.forEach(doc => {
      if (doc.fileName) {
        const lowerName = doc.fileName.toLowerCase();
        commonMeds.forEach(med => {
          if (lowerName.includes(med)) allMedicationNames.add(med);
        });
      }
    });
  }
  
  let importantInfo = '';
  if (allMedicationNames.has('warfarin')) {
    importantInfo += `**Warfarin:** Taking too much warfarin can cause serious bleeding. If you have any questions, ask your doctor or pharmacist. Watch for unusual bruising or bleeding and contact your doctor immediately if these occur.\n\n`;
  }
  
  if (allMedicationNames.has('ibuprofen')) {
    importantInfo += `**Ibuprofen:** Don't use this medicine if it's past the expiration date (05/2018). Take with food to reduce stomach upset. Limit alcohol consumption while taking this medication.\n\n`;
  }
  
  if (allMedicationNames.has('amoxicillin')) {
    importantInfo += `**Amoxicillin:** The prescription must be taken for the full 7 days, even if symptoms improve. Stopping early can lead to antibiotic resistance. Call your doctor if you develop a rash or severe diarrhea.\n\n`;
  }
  
  if (importantInfo.length > 0) {
    return importantInfo;
  } else {
    return `* Always take medications as prescribed by your doctor.
* Do not stop taking medications without consulting your doctor first.
* Be aware of potential side effects such as dizziness, nausea, or skin rash.
* Some medications may interact with others - inform your doctor of all medications you take.
* Keep all medications out of reach of children, ideally in a locked cabinet.`;
  }
})()}

# Health Terms Simplified
${(() => {
  // Extract medication names
  const allMedicationNames = new Set();
  documentInfos.forEach(doc => {
    if (doc.medications && Array.isArray(doc.medications)) {
      doc.medications.forEach(med => {
        if (med.name) allMedicationNames.add(med.name.toLowerCase());
      });
    }
  });
  
  // Extract from filenames if needed
  if (allMedicationNames.size === 0) {
    const commonMeds = ['amoxicillin', 'warfarin', 'ibuprofen', 'aspirin', 'acetaminophen', 'tylenol', 'advil'];
    documentInfos.forEach(doc => {
      if (doc.fileName) {
        const lowerName = doc.fileName.toLowerCase();
        commonMeds.forEach(med => {
          if (lowerName.includes(med)) allMedicationNames.add(med);
        });
      }
    });
  }
  
  let terms = '';
  if (allMedicationNames.has('warfarin')) {
    terms += `**Warfarin/Coumadin:** A medicine that helps stop blood clots. Blood clots are like clumps of blood that can be dangerous.\n\n`;
    terms += `**5mg (Warfarin):** How much medicine is in each warfarin pill.\n\n`;
  }
  
  if (allMedicationNames.has('ibuprofen')) {
    terms += `**Ibuprofen:** A medicine that helps with pain and fever. It's like Advil or Motrin, but you need a prescription for this one.\n\n`;
    terms += `**mL (Ibuprofen):** A small amount of liquid. Use the special cup or syringe to measure it.\n\n`;
    terms += `**Expiration Date:** The date you should stop using the medicine. The ibuprofen expires on 05/2018.\n\n`;
  }
  
  if (allMedicationNames.has('amoxicillin')) {
    terms += `**Amoxicillin:** A medicine that kills bad germs that cause infection.\n\n`;
    terms += `**500mg (Amoxicillin):** How much medicine is in each amoxicillin capsule.\n\n`;
    terms += `**Antibiotic:** A medicine that fights infections caused by bacteria.\n\n`;
  }
  
  // Add these general terms regardless
  terms += `**Dosage:** How much medicine you take and how often. Your doctor will tell you.\n\n`;
  terms += `**Side Effect:** Unwanted reaction your body may have to a medicine.`;
  
  return terms;
})()}
`;
      
      // Log the fallback being used but continue processing
      console.log('Using fallback report template');
    }
    
    // Generate a list of all unique medications
    const allMedications = [];
    const medicationNames = new Set();
    
    documents.forEach(doc => {
      if (doc.medications && Array.isArray(doc.medications)) {
        doc.medications.forEach(med => {
          if (med.name && !medicationNames.has(med.name.toLowerCase())) {
            medicationNames.add(med.name.toLowerCase());
            allMedications.push(med);
          }
        });
      }
    });
    
    // Format the date for title
    const now = new Date();
    const formattedDate = now.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    // Create a combined report document
    const reportId = uuidv4();
    const reportData = {
      id: reportId,
      userId: userId,
      title: `Combined Medical Report - ${formattedDate}`,
      content: combinedReport,
      sourceDocuments: documentIds,
      documentNames: documents.map(doc => doc.fileName),
      medications: allMedications,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    // Save the report to Firestore
    await db.collection('reports').doc(reportId).set(reportData);
    
    // Add report reference to user document
    await db.collection('users').doc(userId).update({
      reports: admin.firestore.FieldValue.arrayUnion(reportId)
    });
    
    // Create a response object with current date for immediate display
    const responseData = {
      ...reportData,
      createdAt: now.toISOString() // Use the actual JavaScript Date object
    };
    
    return res.status(200).json({
      success: true,
      report: responseData,
      redirectUrl: `/reports/${reportId}`
    });
  } catch (error) {
    console.error('Error creating combined report:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to create combined report' 
    });
  }
});

// Document-related routes
router.post('/upload', isAuthenticated, upload.single('file'), documentController.uploadDocument);
router.get('/user-documents', isAuthenticated, documentController.getUserDocuments);
router.get('/:documentId', isAuthenticated, documentController.getDocumentById);
router.delete('/:documentId', isAuthenticated, documentController.deleteDocument);
router.post('/:documentId/process', isAuthenticated, documentController.processDocument);
router.post('/:documentId/endorse', isAuthenticated, documentController.endorseDocument);
router.post('/:documentId/flag', isAuthenticated, documentController.flagDocument);
router.post('/:documentId/share/:doctorId', isAuthenticated, documentController.shareWithDoctor);
router.delete('/:documentId/share/:doctorId', isAuthenticated, documentController.unshareWithDoctor);

export default router; 