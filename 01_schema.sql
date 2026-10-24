-- Hospital Emergency Management System
-- Schema follows the entities and relations in the original ER diagram
-- and the uploaded ERDPlus relational schema.
-- Run this file first on a fresh MySQL database.

CREATE DATABASE IF NOT EXISTS hospital_emergency_management;
USE hospital_emergency_management;

CREATE TABLE IF NOT EXISTS PATIENT (
    patient_id INT AUTO_INCREMENT PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    dob DATE NOT NULL,
    gender CHAR(1) NOT NULL,
    blood_group VARCHAR(5),
    phone VARCHAR(15),
    address VARCHAR(200),
    emergency_contact_name VARCHAR(100),
    emergency_contact_phone VARCHAR(15),
    CONSTRAINT chk_patient_gender CHECK (gender IN ('M','F','O'))
);

CREATE TABLE IF NOT EXISTS DEPARTMENT (
    department_id INT AUTO_INCREMENT PRIMARY KEY,
    dept_name VARCHAR(50) NOT NULL,
    location VARCHAR(50),
    head_doctor_id INT NULL,
    CONSTRAINT uq_department_name UNIQUE (dept_name)
);

CREATE TABLE IF NOT EXISTS DOCTOR (
    doctor_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    specialization VARCHAR(50),
    phone VARCHAR(15),
    shift_timing VARCHAR(20),
    availability_status VARCHAR(20) NOT NULL DEFAULT 'Available',
    department_id INT NOT NULL,
    CONSTRAINT fk_doctor_department FOREIGN KEY (department_id)
        REFERENCES DEPARTMENT(department_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_doctor_availability CHECK
        (availability_status IN ('Available','Busy','Unavailable'))
);

ALTER TABLE DEPARTMENT
    ADD CONSTRAINT fk_department_head_doctor
    FOREIGN KEY (head_doctor_id) REFERENCES DOCTOR(doctor_id)
    ON UPDATE CASCADE ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS NURSE_STAFF (
    staff_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    role VARCHAR(30) NOT NULL,
    phone VARCHAR(15),
    shift_timing VARCHAR(20),
    department_id INT NOT NULL,
    CONSTRAINT fk_staff_department FOREIGN KEY (department_id)
        REFERENCES DEPARTMENT(department_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS AMBULANCE (
    ambulance_id INT AUTO_INCREMENT PRIMARY KEY,
    vehicle_number VARCHAR(20) NOT NULL UNIQUE,
    driver_name VARCHAR(100),
    driver_phone VARCHAR(15),
    status VARCHAR(20) NOT NULL DEFAULT 'Available',
    patient_id INT NOT NULL,
    CONSTRAINT fk_ambulance_patient FOREIGN KEY (patient_id)
        REFERENCES PATIENT(patient_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_ambulance_status CHECK
        (status IN ('Available','On Call','Under Maintenance'))
);

CREATE TABLE IF NOT EXISTS HOSPITAL_BED (
    bed_id INT AUTO_INCREMENT PRIMARY KEY,
    ward_type VARCHAR(30) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Available',
    department_id INT NOT NULL,
    CONSTRAINT fk_bed_department FOREIGN KEY (department_id)
        REFERENCES DEPARTMENT(department_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_bed_status CHECK
        (status IN ('Available','Occupied','Maintenance'))
);

CREATE TABLE IF NOT EXISTS EMERGENCY_CASE (
    case_id INT AUTO_INCREMENT PRIMARY KEY,
    arrival_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    arrival_mode VARCHAR(30) NOT NULL,
    chief_complaint VARCHAR(255),
    triage_level INT NOT NULL,
    case_status VARCHAR(30) NOT NULL DEFAULT 'Open',
    ambulance_id INT NOT NULL,
    patient_id INT NOT NULL,
    bed_id INT NOT NULL,
    CONSTRAINT fk_case_ambulance FOREIGN KEY (ambulance_id)
        REFERENCES AMBULANCE(ambulance_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_case_patient FOREIGN KEY (patient_id)
        REFERENCES PATIENT(patient_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_case_bed FOREIGN KEY (bed_id)
        REFERENCES HOSPITAL_BED(bed_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_case_triage CHECK (triage_level BETWEEN 1 AND 5),
    CONSTRAINT chk_case_status CHECK
        (case_status IN ('Open','Under Treatment','Admitted','Discharged','Closed'))
);

CREATE TABLE IF NOT EXISTS TREATMENT (
    treatment_id INT AUTO_INCREMENT PRIMARY KEY,
    treatment_description VARCHAR(255),
    start_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    end_time DATETIME NULL,
    doctor_id INT NOT NULL,
    case_id INT NOT NULL,
    CONSTRAINT fk_treatment_doctor FOREIGN KEY (doctor_id)
        REFERENCES DOCTOR(doctor_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_treatment_case FOREIGN KEY (case_id)
        REFERENCES EMERGENCY_CASE(case_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chk_treatment_times CHECK (end_time IS NULL OR end_time >= start_time)
);

CREATE TABLE IF NOT EXISTS MEDICINE (
    medicine_id INT AUTO_INCREMENT PRIMARY KEY,
    medicine_name VARCHAR(100) NOT NULL,
    type VARCHAR(50),
    manufacturer VARCHAR(100),
    stock_quantity INT NOT NULL DEFAULT 0,
    unit_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    CONSTRAINT chk_medicine_stock CHECK (stock_quantity >= 0),
    CONSTRAINT chk_medicine_price CHECK (unit_price >= 0)
);

CREATE TABLE IF NOT EXISTS DIAGNOSTIC_TEST (
    test_id INT AUTO_INCREMENT PRIMARY KEY,
    test_name VARCHAR(100) NOT NULL,
    test_type VARCHAR(50),
    cost DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    CONSTRAINT chk_test_cost CHECK (cost >= 0)
);

CREATE TABLE IF NOT EXISTS PRESCRIPTION (
    prescription_id INT AUTO_INCREMENT PRIMARY KEY,
    dosage VARCHAR(100) NOT NULL,
    frequency VARCHAR(100) NOT NULL,
    date_issued DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    case_id INT NOT NULL,
    medicine_id INT NOT NULL,
    doctor_id INT NOT NULL,
    CONSTRAINT fk_prescription_case FOREIGN KEY (case_id)
        REFERENCES EMERGENCY_CASE(case_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_prescription_medicine FOREIGN KEY (medicine_id)
        REFERENCES MEDICINE(medicine_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_prescription_doctor FOREIGN KEY (doctor_id)
        REFERENCES DOCTOR(doctor_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS TEST_ORDER (
    test_order_id INT AUTO_INCREMENT PRIMARY KEY,
    order_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    result_status VARCHAR(30) NOT NULL DEFAULT 'Ordered',
    result_value VARCHAR(255),
    case_id INT NOT NULL,
    doctor_id INT NOT NULL,
    test_id INT NOT NULL,
    CONSTRAINT fk_test_order_case FOREIGN KEY (case_id)
        REFERENCES EMERGENCY_CASE(case_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_test_order_doctor FOREIGN KEY (doctor_id)
        REFERENCES DOCTOR(doctor_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_test_order_test FOREIGN KEY (test_id)
        REFERENCES DIAGNOSTIC_TEST(test_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_test_order_status CHECK
        (result_status IN ('Ordered','In Progress','Completed','Cancelled'))
);

CREATE TABLE IF NOT EXISTS BILLING (
    bill_id INT AUTO_INCREMENT PRIMARY KEY,
    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    payment_status VARCHAR(20) NOT NULL DEFAULT 'Pending',
    payment_mode VARCHAR(20),
    bill_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    case_id INT NOT NULL UNIQUE,
    CONSTRAINT fk_billing_case FOREIGN KEY (case_id)
        REFERENCES EMERGENCY_CASE(case_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_billing_total CHECK (total_amount >= 0),
    CONSTRAINT chk_billing_status CHECK
        (payment_status IN ('Pending','Partially Paid','Paid'))
);

CREATE INDEX idx_patient_name ON PATIENT(last_name, first_name);
CREATE INDEX idx_case_arrival ON EMERGENCY_CASE(arrival_time);
CREATE INDEX idx_case_status ON EMERGENCY_CASE(case_status);
CREATE INDEX idx_case_triage ON EMERGENCY_CASE(triage_level);
CREATE INDEX idx_treatment_case ON TREATMENT(case_id);
CREATE INDEX idx_test_order_case ON TEST_ORDER(case_id);
CREATE INDEX idx_prescription_case ON PRESCRIPTION(case_id);
CREATE INDEX idx_bed_status ON HOSPITAL_BED(status);
CREATE INDEX idx_medicine_name ON MEDICINE(medicine_name);
