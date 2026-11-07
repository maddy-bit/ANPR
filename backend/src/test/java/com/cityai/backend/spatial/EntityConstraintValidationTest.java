package com.cityai.backend.spatial;

import com.cityai.backend.model.AuditLogEntry;
import com.cityai.backend.model.Vehicle;
import com.cityai.backend.model.VehicleDetection;
import jakarta.persistence.Column;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.lang.reflect.Field;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Validates JPA entity declarations against required foreign-key relationships,
 * unique constraints, and nullable associations.
 */
class EntityConstraintValidationTest {

    @Test
    void vehicle_EnforcesUniquePlateConstraint() throws NoSuchFieldException {
        Table tableAnn = Vehicle.class.getAnnotation(Table.class);
        assertThat(tableAnn).isNotNull();
        assertThat(tableAnn.uniqueConstraints())
                .anyMatch(uc -> uc.columnNames().length == 1 && uc.columnNames()[0].equals("plate"));

        Field plateField = Vehicle.class.getDeclaredField("plate");
        Column colAnn = plateField.getAnnotation(Column.class);
        assertThat(colAnn).isNotNull();
        assertThat(colAnn.nullable()).isFalse();
        assertThat(colAnn.unique()).isTrue();
    }

    @Test
    void vehicleDetection_PreservesNullableVehicleAssociationForUnreadablePlates() throws NoSuchFieldException {
        Field vehicleField = VehicleDetection.class.getDeclaredField("vehicle");
        ManyToOne manyToOne = vehicleField.getAnnotation(ManyToOne.class);
        assertThat(manyToOne).isNotNull();
        // optional = true allows detection to be persisted when plate OCR cannot recognize the identity
        assertThat(manyToOne.optional()).isTrue();

        JoinColumn joinCol = vehicleField.getAnnotation(JoinColumn.class);
        assertThat(joinCol).isNotNull();
        assertThat(joinCol.name()).isEqualTo("vehicle_id");
        // nullable is true by default on JoinColumn, not set to false
        assertThat(joinCol.nullable()).isTrue();
    }

    @Test
    void vehicleDetection_EnforcesMandatoryCameraAssociation() throws NoSuchFieldException {
        Field cameraField = VehicleDetection.class.getDeclaredField("camera");
        ManyToOne manyToOne = cameraField.getAnnotation(ManyToOne.class);
        assertThat(manyToOne).isNotNull();
        // Every detection MUST belong to a registered camera checkpoint
        assertThat(manyToOne.optional()).isFalse();

        JoinColumn joinCol = cameraField.getAnnotation(JoinColumn.class);
        assertThat(joinCol).isNotNull();
        assertThat(joinCol.name()).isEqualTo("camera_id");
    }

    @Test
    void vehicleDetection_EnforcesMandatoryTimestamp() throws NoSuchFieldException {
        Field timestampField = VehicleDetection.class.getDeclaredField("timestamp");
        Column col = timestampField.getAnnotation(Column.class);
        assertThat(col).isNotNull();
        assertThat(col.nullable()).isFalse();
    }

    @Test
    void auditLogEntry_EntityMapping() throws NoSuchFieldException {
        Table table = AuditLogEntry.class.getAnnotation(Table.class);
        assertThat(table).isNotNull();
        assertThat(table.name()).isEqualTo("audit_log_entries");

        Field actionField = AuditLogEntry.class.getDeclaredField("action");
        assertThat(actionField.getType()).isEqualTo(String.class);

        Field timestampField = AuditLogEntry.class.getDeclaredField("timestamp");
        assertThat(timestampField.getType()).isEqualTo(java.time.Instant.class);
    }
}

