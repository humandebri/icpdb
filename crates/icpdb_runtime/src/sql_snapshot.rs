// Where: crates/icpdb_runtime/src/sql_snapshot.rs
// What: In-memory rollback snapshots for SQLite write execution.
// Why: Failed write statements must restore the database image without mixing rollback details into SQL execution.

const SQL_ROLLBACK_CHUNK_BYTES: u64 = 64 * 1024;

pub(crate) struct DatabaseSnapshot {
    size: u64,
    checksum: u64,
    chunks: Vec<Vec<u8>>,
}

impl DatabaseSnapshot {
    pub(crate) fn capture(database_path: &str) -> Result<Self, String> {
        let size = crate::sqlite_facade::database_image_size(database_path)
            .map_err(|error| error.to_string())?;
        let mut checksum = crate::sqlite_facade::fnv1a64_init();
        let mut chunks = Vec::new();
        let mut offset = 0_u64;
        while offset < size {
            let chunk_len = (size - offset).min(SQL_ROLLBACK_CHUNK_BYTES);
            let chunk =
                crate::sqlite_facade::export_database_image_chunk(database_path, offset, chunk_len)
                    .map_err(|error| error.to_string())?;
            if chunk.is_empty() {
                break;
            }
            checksum = crate::sqlite_facade::fnv1a64_update(checksum, &chunk);
            offset += u64::try_from(chunk.len()).map_err(|error| error.to_string())?;
            chunks.push(chunk);
        }
        Ok(Self {
            size,
            checksum,
            chunks,
        })
    }

    pub(crate) fn restore(&self, database_path: &str) -> Result<(), String> {
        crate::sqlite_facade::begin_database_image_import(database_path, self.size, self.checksum)
            .map_err(|error| error.to_string())?;
        let mut offset = 0_u64;
        for chunk in &self.chunks {
            crate::sqlite_facade::import_database_image_chunk(database_path, offset, chunk)
                .map_err(|error| error.to_string())?;
            offset += u64::try_from(chunk.len()).map_err(|error| error.to_string())?;
        }
        crate::sqlite_facade::finish_database_image_import(database_path)
            .map_err(|error| error.to_string())
    }
}
