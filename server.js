const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();
const port = 3000;

// Database configuration
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'offboarding_db',
    password: 'root',
    port: 5432,
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath);
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain',
            'image/jpeg',
            'image/png'
        ];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'));
        }
    }
});

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Submit offboarding form
app.post('/api/offboarding/submit', upload.array('projectDocs', 5), async (req, res) => {
    const {
        personalInfo, projectDetails, assets, documentation, submissionDetails
    } = req.body;

    try {
        const parsedPersonalInfo = JSON.parse(personalInfo);
        const parsedProjectDetails = JSON.parse(projectDetails);
        const parsedAssets = JSON.parse(assets);
        const parsedDocumentation = JSON.parse(documentation);
        const parsedSubmissionDetails = JSON.parse(submissionDetails);

        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Check for duplicates
            const duplicateCheck = await client.query(
                'SELECT emp_id, contact_number, personal_email FROM employee_info WHERE emp_id = $1 OR contact_number = $2 OR personal_email = $3',
                [parsedPersonalInfo.empId, parsedPersonalInfo.contactNumber, parsedPersonalInfo.personalEmail]
            );

            if (duplicateCheck.rows.length > 0) {
                throw new Error('Duplicate employee ID, contact number, or email found');
            }

            // Insert employee info
            const employeeResult = await client.query(
                `INSERT INTO employee_info (full_name, emp_id, position, department, last_working_day, contact_number, personal_email)
                VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                [
                    parsedPersonalInfo.fullName,
                    parsedPersonalInfo.empId,
                    parsedPersonalInfo.position,
                    parsedPersonalInfo.department,
                    parsedPersonalInfo.lastDay,
                    parsedPersonalInfo.contactNumber,
                    parsedPersonalInfo.personalEmail
                ]
            );

            const employeeId = employeeResult.rows[0].id;

            // Insert submission details
            const submissionResult = await client.query(
                `INSERT INTO submission_details (employee_id, submission_id, submission_date, status)
                VALUES ($1, $2, $3, $4) RETURNING id`,
                [
                    employeeId,
                    parsedSubmissionDetails.submissionId,
                    parsedSubmissionDetails.submissionDate,
                    parsedSubmissionDetails.status
                ]
            );

            const submissionId = submissionResult.rows[0].id;

            // Insert project details
            await client.query(
                `INSERT INTO project_details (submission_id, active_projects, handover_person)
                VALUES ($1, $2, $3)`,
                [
                    submissionId,
                    parsedProjectDetails.activeProjects,
                    parsedProjectDetails.handoverPerson
                ]
            );

            // Insert project documents
            for (const file of req.files) {
                await client.query(
                    `INSERT INTO project_documents (submission_id, file_name, file_path, file_size, file_type)
                    VALUES ($1, $2, $3, $4, $5)`,
                    [
                        submissionId,
                        file.originalname,
                        file.path,
                        file.size,
                        file.mimetype
                    ]
                );
            }

            // Insert assets
            for (const hardware of parsedAssets.hardware) {
                await client.query(
                    `INSERT INTO assets (submission_id, hardware_type)
                    VALUES ($1, $2)`,
                    [submissionId, hardware]
                );
            }

            if (parsedAssets.additionalAssets) {
                await client.query(
                    `INSERT INTO additional_assets (submission_id, description)
                    VALUES ($1, $2)`,
                    [submissionId, parsedAssets.additionalAssets]
                );
            }

            // Insert documentation
            await client.query(
                `INSERT INTO documentation (submission_id, repositories, access_credentials, knowledge_base, data_privacy_consent)
                VALUES ($1, $2, $3, $4, $5)`,
                [
                    submissionId,
                    parsedDocumentation.repositories,
                    parsedDocumentation.accessCredentials,
                    parsedDocumentation.knowledgeBase,
                    parsedDocumentation.dataPrivacyConsent
                ]
            );

            await client.query('COMMIT');
            res.status(201).json({
                message: 'Offboarding submission successful',
                submissionId: parsedSubmissionDetails.submissionId
            });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error submitting offboarding form:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all submissions for HR dashboard
app.get('/api/offboarding/submissions', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                s.id as submission_id,
                s.submission_id as submission_ref,
                s.submission_date,
                s.status,
                e.full_name,
                e.emp_id,
                e.position,
                e.department,
                e.last_working_day,
                e.contact_number,
                e.personal_email,
                p.active_projects,
                p.handover_person,
                d.repositories,
                d.access_credentials,
                d.knowledge_base,
                d.data_privacy_consent,
                aa.description as additional_assets,
                COALESCE((
                    SELECT json_agg(json_build_object(
                        'id', pd.id,
                        'name', pd.file_name,
                        'path', pd.file_path,
                        'size', pd.file_size,
                        'type', pd.file_type
                    ))
                    FROM project_documents pd
                    WHERE pd.submission_id = s.id
                ), '[]'::json) as project_docs,
                COALESCE((
                    SELECT json_agg(a.hardware_type)
                    FROM assets a
                    WHERE a.submission_id = s.id
                ), '[]'::json) as hardware
            FROM submission_details s
            JOIN employee_info e ON s.employee_id = e.id
            LEFT JOIN project_details p ON s.id = p.submission_id
            LEFT JOIN documentation d ON s.id = d.submission_id
            LEFT JOIN additional_assets aa ON s.id = aa.submission_id
            ORDER BY s.submission_date DESC
        `);

        const submissions = result.rows.map(row => ({
            submissionDetails: {
                submissionId: row.submission_ref,
                submissionDate: row.submission_date,
                status: row.status
            },
            personalInfo: {
                fullName: row.full_name,
                empId: row.emp_id,
                position: row.position,
                department: row.department,
                lastDay: row.last_working_day,
                contactNumber: row.contact_number,
                personalEmail: row.personal_email
            },
            projectDetails: {
                activeProjects: row.active_projects,
                handoverPerson: row.handover_person,
                projectDocs: row.project_docs.filter(doc => doc.id).map(doc => ({
                    id: doc.id,
                    name: doc.name,
                    path: doc.path,
                    size: doc.size,
                    type: doc.type
                }))
            },
            assets: {
                hardware: row.hardware.filter(h => h),
                additionalAssets: row.additional_assets
            },
            documentation: {
                repositories: row.repositories,
                accessCredentials: row.access_credentials,
                knowledgeBase: row.knowledge_base,
                dataPrivacyConsent: row.data_privacy_consent
            }
        }));

        res.json(submissions);
    } catch (error) {
        console.error('Error fetching submissions:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update submission status
app.patch('/api/offboarding/submissions/:submissionId/status', async (req, res) => {
    const { submissionId } = req.params;
    const { status } = req.body;

    try {
        const result = await pool.query(
            `UPDATE submission_details 
            SET status = $1, updated_at = CURRENT_TIMESTAMP
            WHERE submission_id = $2
            RETURNING id`,
            [status, submissionId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Submission not found' });
        }

        res.json({ message: `Submission status updated to ${status}` });
    } catch (error) {
        console.error('Error updating submission status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete submissions
app.delete('/api/offboarding/submissions', async (req, res) => {
    const { submissionIds } = req.body;
    console.log('Received submissionIds:', submissionIds);

    if (!Array.isArray(submissionIds) || submissionIds.length === 0) {
        return res.status(400).json({ error: 'submissionIds must be a non-empty array' });
    }

    try {
        const client = await pool.connect();
        try {
            await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');

            // Check records before deletion
            const beforeResult = await client.query(
                `SELECT id, employee_id, submission_id FROM submission_details WHERE submission_id = ANY($1)`,
                [submissionIds]
            );
            console.log('Records before deletion:', beforeResult.rows);

            // Get file paths to delete
            const fileResult = await client.query(
                `SELECT file_path FROM project_documents 
                WHERE submission_id = ANY(
                    SELECT id FROM submission_details WHERE submission_id = ANY($1)
                )`,
                [submissionIds]
            );
            console.log('Files to delete:', fileResult.rows);

            // Delete files asynchronously
            const deletePromises = fileResult.rows.map(row => 
                new Promise(resolve => {
                    if (fs.existsSync(row.file_path)) {
                        fs.unlink(row.file_path, err => {
                            if (err) console.error(`Error deleting file ${row.file_path}:`, err);
                            resolve();
                        });
                    } else {
                        console.log(`File not found: ${row.file_path}`);
                        resolve();
                    }
                })
            );
            await Promise.all(deletePromises);

            // Delete submission data
            const result = await client.query(
                `DELETE FROM submission_details 
                WHERE TRIM(UPPER(REGEXP_REPLACE(submission_id, '[\\r\\n\\t]', '', 'g'))) = ANY(SELECT UPPER(unnest($1::text[])))
                RETURNING id, employee_id`,
                [submissionIds.map(id => id.trim())]
            );
            console.log(`Deleted ${result.rows.length} submissions`, result.rows);

            // Explicitly delete from employee_info
            if (result.rows.length > 0) {
                const employeeIds = result.rows.map(row => row.employee_id);
                const deleteEmployeeResult = await client.query(
                    `DELETE FROM employee_info WHERE id = ANY($1) RETURNING *`,
                    [employeeIds]
                );
                console.log(`Deleted ${deleteEmployeeResult.rows.length} employee_info records`, deleteEmployeeResult.rows);
            }

            await client.query('COMMIT');
            console.log('Transaction committed successfully');

            // Verify deletion in submission_details
            const verifyResult = await client.query(
                `SELECT id, employee_id, submission_id FROM submission_details WHERE submission_id = ANY($1)`,
                [submissionIds]
            );
            console.log('Records after deletion in submission_details:', verifyResult.rows);

            // Verify deletion in employee_info
            if (result.rows.length > 0) {
                const employeeIds = result.rows.map(row => row.employee_id);
                const verifyEmployeeResult = await client.query(
                    `SELECT * FROM employee_info WHERE id = ANY($1)`,
                    [employeeIds]
                );
                console.log('Records after deletion in employee_info:', verifyEmployeeResult.rows);
            }

            res.json({ message: `${result.rows.length} submissions deleted` });
        } catch (error) {
            await client.query('ROLLBACK');
            console.log('Transaction rolled back due to error:', error.message);
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error deleting submissions:', error, error.stack);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// Download file
app.get('/api/offboarding/files/:fileId', async (req, res) => {
    const { fileId } = req.params;
    try {
        const result = await pool.query(
            `SELECT file_name, file_path, file_type 
            FROM project_documents 
            WHERE id = $1`,
            [fileId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'File not found' });
        }
        const file = result.rows[0];
        res.download(file.file_path, file.file_name);
    } catch (error) {
        console.error('Error downloading file:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/offboarding/check-duplicate', async (req, res) => {
    const { field, value } = req.body;
    try {
        const queryField = field === 'empId' ? 'emp_id' : field === 'contactNumber' ? 'contact_number' : 'personal_email';
        const result = await pool.query(
            `SELECT 1 FROM employee_info WHERE ${queryField} = $1`,
            [value]
        );
        res.json({ isDuplicate: result.rows.length > 0 });
    } catch (error) {
        console.error('Error checking duplicate:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});