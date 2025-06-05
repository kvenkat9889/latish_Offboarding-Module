-- Create employee_info table
CREATE TABLE employee_info (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(50) NOT NULL,
    emp_id VARCHAR(7) NOT NULL UNIQUE,
    position VARCHAR(50) NOT NULL,
    department VARCHAR(50) NOT NULL,
    last_working_day DATE NOT NULL,
    contact_number VARCHAR(10) NOT NULL UNIQUE,
    personal_email VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create submission_details table
CREATE TABLE submission_details (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employee_info(id) ON DELETE CASCADE,
    submission_id VARCHAR(50) NOT NULL UNIQUE,
    submission_date TIMESTAMP NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('Pending', 'Approved', 'Rejected')),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create project_details table
CREATE TABLE project_details (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER NOT NULL REFERENCES submission_details(id) ON DELETE CASCADE,
    active_projects TEXT NOT NULL,
    handover_person VARCHAR(50) NOT NULL
);

-- Create project_documents table
CREATE TABLE project_documents (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER NOT NULL REFERENCES submission_details(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(255) NOT NULL,
    file_size INTEGER NOT NULL,
    file_type VARCHAR(100) NOT NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create assets table
CREATE TABLE assets (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER NOT NULL REFERENCES submission_details(id) ON DELETE CASCADE,
    hardware_type VARCHAR(50) NOT NULL
);

-- Create additional_assets table
CREATE TABLE additional_assets (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER NOT NULL REFERENCES submission_details(id) ON DELETE CASCADE,
    description TEXT
);

-- Create documentation table
CREATE TABLE documentation (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER NOT NULL REFERENCES submission_details(id) ON DELETE CASCADE,
    repositories TEXT NOT NULL,
    access_credentials TEXT NOT NULL,
    knowledge_base TEXT NOT NULL,
    data_privacy_consent BOOLEAN NOT NULL
);

-- Create indexes for better query performance
CREATE INDEX idx_submission_details_employee_id ON submission_details(employee_id);
CREATE INDEX idx_submission_details_submission_id ON submission_details(submission_id);
CREATE INDEX idx_project_details_submission_id ON project_details(submission_id);
CREATE INDEX idx_project_documents_submission_id ON project_documents(submission_id);
CREATE INDEX idx_assets_submission_id ON assets(submission_id);
CREATE INDEX idx_additional_assets_submission_id ON additional_assets(submission_id);
CREATE INDEX idx_documentation_submission_id ON documentation(submission_id);
