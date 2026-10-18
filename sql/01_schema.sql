
CREATE DATABASE IF NOT EXISTS hospital_management;
USE hospital_management;

CREATE TABLE department (
    department_id INT AUTO_INCREMENT PRIMARY KEY,
    department_name VARCHAR(100) NOT NULL UNIQUE,
    location VARCHAR(100)
);

CREATE TABLE patient (
    patient_id INT AUTO_INCREMENT PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    dob DATE NOT NULL,
    gender CHAR(1) NOT NULL,
    blood_group VARCHAR(5),
    phone VARCHAR(15) UNIQUE,
    address VARCHAR(255),
    CONSTRAINT chk_patient_gender
        CHECK (gender IN ('M', 'F', 'O'))
);

CREATE TABLE doctor (
    doctor_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    specialization VARCHAR(50),
    phone VARCHAR(15) UNIQUE,
    shift_timing VARCHAR(20),
    availability_status VARCHAR(20) NOT NULL DEFAULT 'Available',
    department_id INT NOT NULL,
    CONSTRAINT fk_doctor_department
        FOREIGN KEY (department_id)
        REFERENCES department(department_id),
    CONSTRAINT chk_doctor_availability
        CHECK (availability_status IN ('Available', 'Unavailable'))
);

CREATE TABLE appointment (
    appointment_id INT AUTO_INCREMENT PRIMARY KEY,
    patient_id INT NOT NULL,
    doctor_id INT NOT NULL,
    appointment_datetime DATETIME NOT NULL,
    reason VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'Scheduled',
    CONSTRAINT fk_appointment_patient
        FOREIGN KEY (patient_id)
        REFERENCES patient(patient_id),
    CONSTRAINT fk_appointment_doctor
        FOREIGN KEY (doctor_id)
        REFERENCES doctor(doctor_id),
    CONSTRAINT chk_appointment_status
        CHECK (status IN (
            'Scheduled', 'Completed', 'Cancelled'
        ))
);

CREATE TABLE medical_record (
    record_id INT AUTO_INCREMENT PRIMARY KEY,
    patient_id INT NOT NULL,
    doctor_id INT NOT NULL,
    appointment_id INT,
    diagnosis VARCHAR(255) NOT NULL,
    treatment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_record_patient
        FOREIGN KEY (patient_id)
        REFERENCES patient(patient_id),
    CONSTRAINT fk_record_doctor
        FOREIGN KEY (doctor_id)
        REFERENCES doctor(doctor_id),
    CONSTRAINT fk_record_appointment
        FOREIGN KEY (appointment_id)
        REFERENCES appointment(appointment_id)
);

-- Indexes for common searches
CREATE INDEX idx_appointment_datetime
    ON appointment(appointment_datetime);

CREATE INDEX idx_appointment_patient
    ON appointment(patient_id);

CREATE INDEX idx_doctor_department
    ON doctor(department_id);
