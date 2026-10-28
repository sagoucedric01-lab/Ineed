-- Les communes ont parent_id = NULL : avec une contrainte UNIQUE classique, deux communes
-- de même nom dans la même ville étaient acceptées (NULL ≠ NULL). PostgreSQL 15+ : NULLS NOT DISTINCT.
ALTER TABLE zones DROP CONSTRAINT zones_city_id_parent_id_name_key;
ALTER TABLE zones ADD CONSTRAINT zones_city_id_parent_id_name_key
  UNIQUE NULLS NOT DISTINCT (city_id, parent_id, name);
