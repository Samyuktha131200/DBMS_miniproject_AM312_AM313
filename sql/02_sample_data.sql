
USE hospital_management;

INSERT INTO department (department_name, location)
VALUES
    ('Cardiology', 'Block A'),
    ('Neurology', 'Block B'),
    ('Orthopedics', 'Block C');

INSERT INTO patient
    (first_name, last_name, dob, gender, blood_group, phone, address)
VALUES
    ('Aarav', 'Sharma', '2002-04-15', 'M', 'O+', '9000000001', 'Bengaluru'),
    ('Diya', 'Rao', '1998-09-21', 'F', 'A+', '9000000002', 'Mysuru');

INSERT INTO doctor
    (name, specialization, phone, shift_timing,
     availability_status, department_id)
VALUES
    ('Dr. Meera Nair', 'Cardiology', '9111111111',
     'Morning', 'Available', 1),
    ('Dr. Arjun Rao', 'Neurology', '9222222222',
     'Evening', 'Available', 2);

INSERT INTO appointment
    (patient_id, doctor_id, appointment_datetime, reason, status)
VALUES
    (1, 1, '2026-11-02 10:00:00',
     'Routine consultation', 'Scheduled'),
    (2, 2, '2026-11-02 16:00:00',
     'Follow-up consultation', 'Scheduled');
