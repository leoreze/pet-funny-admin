-- Patch de integridade para deploys que migram bookings antigos para booking_services
-- e para ambientes que já possuem agendamentos vinculados a pacotes.

BEGIN;

UPDATE bookings b
   SET service_id = NULL
 WHERE service_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1
       FROM services s
      WHERE s.id = b.service_id
   );

INSERT INTO booking_services (booking_id, service_id)
SELECT b.id, b.service_id
  FROM bookings b
 WHERE b.service_id IS NOT NULL
   AND EXISTS (
     SELECT 1
       FROM services s
      WHERE s.id = b.service_id
   )
   AND NOT EXISTS (
     SELECT 1
       FROM booking_services bs
      WHERE bs.booking_id = b.id
        AND bs.service_id = b.service_id
   );

COMMIT;
