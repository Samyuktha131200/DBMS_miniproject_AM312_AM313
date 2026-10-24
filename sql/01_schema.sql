CREATE DATABASE IF NOT EXISTS hospital_emergency_management;
USE hospital_emergency_management;

CREATE TABLE IF NOT EXISTS patient (
patient_id INT AUTO_INCREMENT PRIMARY KEY,
patient_name VARCHAR(100) NOT NULL,
age INT,
gender VARCHAR(20),
phone VARCHAR(15),
blood_group VARCHAR(5),
address VARCHAR(255),
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT chk_patient_age CHECK (age IS NULL OR age BETWEEN 0 AND 120)
);

CREATE TABLE IF NOT EXISTS doctor (
doctor_id INT AUTO_INCREMENT PRIMARY KEY,
doctor_name VARCHAR(100) NOT NULL,
specialization VARCHAR(100),
phone VARCHAR(15),
availability_status ENUM('Available', 'Busy', 'Unavailable') DEFAULT 'Available'
);

CREATE TABLE IF NOT EXISTS ambulance (
ambulance_id INT AUTO_INCREMENT PRIMARY KEY,
vehicle_number VARCHAR(20) NOT NULL UNIQUE,
driver_name VARCHAR(100),
driver_phone VARCHAR(15),
ambulance_status ENUM('Available', 'On Call', 'Under Maintenance') DEFAULT 'Available'
);

CREATE TABLE IF NOT EXISTS bed (
bed_id INT AUTO_INCREMENT PRIMARY KEY,
bed_number VARCHAR(20) NOT NULL UNIQUE,
bed_type ENUM('General', 'Emergency', 'ICU') NOT NULL,
bed_status ENUM('Available', 'Occupied', 'Maintenance') DEFAULT 'Available',
location VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS emergency_case (
case_id INT AUTO_INCREMENT PRIMARY KEY,
patient_id INT NOT NULL,
doctor_id INT,
ambulance_id INT,
arrival_time DATETIME DEFAULT CURRENT_TIMESTAMP,
emergency_type VARCHAR(100) NOT NULL,
case_description TEXT,
case_status ENUM('Open', 'Under Treatment', 'Admitted', 'Discharged', 'Closed') DEFAULT 'Open',
CONSTRAINT fk_case_patient FOREIGN KEY (patient_id)
REFERENCES patient(patient_id)
ON UPDATE CASCADE ON DELETE RESTRICT,
CONSTRAINT fk_case_doctor FOREIGN KEY (doctor_id)
REFERENCES doctor(doctor_id)
ON UPDATE CASCADE ON DELETE SET NULL,
CONSTRAINT fk_case_ambulance FOREIGN KEY (ambulance_id)
REFERENCES ambulance(ambulance_id)
ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS triage (
triage_id INT AUTO_INCREMENT PRIMARY KEY,
case_id INT NOT NULL UNIQUE,
triage_time DATETIME DEFAULT CURRENT_TIMESTAMP,
severity ENUM('Critical', 'High', 'Moderate', 'Low') NOT NULL,
priority_level INT NOT NULL,
symptoms TEXT,
vital_signs TEXT,
CONSTRAINT fk_triage_case FOREIGN KEY (case_id)
REFERENCES emergency_case(case_id)
ON UPDATE CASCADE ON DELETE CASCADE,
CONSTRAINT chk_triage_priority CHECK (priority_level BETWEEN 1 AND 5)
);

CREATE TABLE IF NOT EXISTS treatment (
treatment_id INT AUTO_INCREMENT PRIMARY KEY,
case_id INT NOT NULL,
doctor_id INT NOT NULL,
treatment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
diagnosis VARCHAR(255),
treatment_description TEXT,
treatment_status ENUM('Planned', 'Ongoing', 'Completed') DEFAULT 'Planned',
CONSTRAINT fk_treatment_case FOREIGN KEY (case_id)
REFERENCES emergency_case(case_id)
ON UPDATE CASCADE ON DELETE CASCADE,
CONSTRAINT fk_treatment_doctor FOREIGN KEY (doctor_id)
REFERENCES doctor(doctor_id)
ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS medicine (
medicine_id INT AUTO_INCREMENT PRIMARY KEY,
medicine_name VARCHAR(100) NOT NULL,
manufacturer VARCHAR(100),
unit_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
stock_quantity INT NOT NULL DEFAULT 0,
expiry_date DATE,
CONSTRAINT chk_medicine_price CHECK (unit_price >= 0),
CONSTRAINT chk_medicine_stock CHECK (stock_quantity >= 0)
);

CREATE TABLE IF NOT EXISTS treatment_medicine (
treatment_id INT NOT NULL,
medicine_id INT NOT NULL,
quantity INT NOT NULL DEFAULT 1,
dosage VARCHAR(100),
PRIMARY KEY (treatment_id, medicine_id),
CONSTRAINT fk_tm_treatment FOREIGN KEY (treatment_id)
REFERENCES treatment(treatment_id)
ON UPDATE CASCADE ON DELETE CASCADE,
CONSTRAINT fk_tm_medicine FOREIGN KEY (medicine_id)
REFERENCES medicine(medicine_id)
ON UPDATE CASCADE ON DELETE RESTRICT,
CONSTRAINT chk_tm_quantity CHECK (quantity > 0)
);

CREATE TABLE IF NOT EXISTS diagnostic_test (
test_id INT AUTO_INCREMENT PRIMARY KEY,
case_id INT NOT NULL,
test_name VARCHAR(100) NOT NULL,
test_date DATETIME DEFAULT CURRENT_TIMESTAMP,
test_result TEXT,
test_status ENUM('Ordered', 'In Progress', 'Completed', 'Cancelled') DEFAULT 'Ordered',
test_cost DECIMAL(10,2) DEFAULT 0.00,
CONSTRAINT fk_test_case FOREIGN KEY (case_id)
REFERENCES emergency_case(case_id)
ON UPDATE CASCADE ON DELETE CASCADE,
CONSTRAINT chk_test_cost CHECK (test_cost >= 0)
);

CREATE TABLE IF NOT EXISTS billing (
bill_id INT AUTO_INCREMENT PRIMARY KEY,
case_id INT NOT NULL UNIQUE,
bill_date DATETIME DEFAULT CURRENT_TIMESTAMP,
consultation_charge DECIMAL(10,2) NOT NULL DEFAULT 0.00,
treatment_charge DECIMAL(10,2) NOT NULL DEFAULT 0.00,
diagnostic_charge DECIMAL(10,2) NOT NULL DEFAULT 0.00,
medicine_charge DECIMAL(10,2) NOT NULL DEFAULT 0.00,
total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
payment_status ENUM('Pending', 'Partially Paid', 'Paid') DEFAULT 'Pending',
payment_method ENUM('Cash', 'Card', 'UPI', 'Insurance', 'Other') DEFAULT 'Other',
CONSTRAINT fk_billing_case FOREIGN KEY (case_id)
REFERENCES emergency_case(case_id)
ON UPDATE CASCADE ON DELETE RESTRICT,
CONSTRAINT chk_billing_amounts CHECK (
consultation_charge >= 0
AND treatment_charge >= 0
AND diagnostic_charge >= 0
AND medicine_charge >= 0
AND total_amount >= 0
)
);

CREATE INDEX idx_case_patient ON emergency_case(patient_id);
CREATE INDEX idx_case_doctor ON emergency_case(doctor_id);
CREATE INDEX idx_case_status ON emergency_case(case_status);
CREATE INDEX idx_case_arrival ON emergency_case(arrival_time);
CREATE INDEX idx_treatment_case ON treatment(case_id);
CREATE INDEX idx_diagnostic_case ON diagnostic_test(case_id);
CREATE INDEX idx_medicine_name ON medicine(medicine_name);
CREATE INDEX idx_bed_status ON bed(bed_status);
