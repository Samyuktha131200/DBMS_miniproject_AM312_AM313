
USE hospital_management;

-- 1. VIEW: upcoming scheduled appointments
CREATE OR REPLACE VIEW upcoming_appointments AS
SELECT
    a.appointment_id,
    a.appointment_datetime,
    a.status,
    p.patient_id,
    CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
    d.doctor_id,
    d.name AS doctor_name,
    dep.department_name
FROM appointment a
JOIN patient p ON a.patient_id = p.patient_id
JOIN doctor d ON a.doctor_id = d.doctor_id
JOIN department dep ON d.department_id = dep.department_id
WHERE a.status = 'Scheduled';

-- Test the view
SELECT * FROM upcoming_appointments;

-- 2. STORED PROCEDURE: appointments for one patient
DELIMITER //

CREATE PROCEDURE GetPatientAppointments(
    IN p_patient_id INT
)
BEGIN
    SELECT
        a.appointment_id,
        a.appointment_datetime,
        a.status,
        d.name AS doctor_name,
        d.specialization
    FROM appointment a
    JOIN doctor d ON a.doctor_id = d.doctor_id
    WHERE a.patient_id = p_patient_id
    ORDER BY a.appointment_datetime;
END //

DELIMITER ;

-- Test the procedure
CALL GetPatientAppointments(1);

-- 3. TRIGGER: prevent appointments with unavailable doctors
DELIMITER //

CREATE TRIGGER check_doctor_availability
BEFORE INSERT ON appointment
FOR EACH ROW
BEGIN
    DECLARE doctor_status VARCHAR(20);

    SELECT availability_status
    INTO doctor_status
    FROM doctor
    WHERE doctor_id = NEW.doctor_id;

    IF doctor_status <> 'Available' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT =
                'Cannot schedule: doctor is unavailable';
    END IF;
END //

DELIMITER ;
