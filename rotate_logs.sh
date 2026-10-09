#!/bin/bash

# Directory containing the logs
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${LOG_DIR:-$SCRIPT_DIR/logs}"
MAX_SIZE_BYTES=5242880 # 5 MB
BACKUP_COUNT=3

# Files to rotate
LOG_FILES=(
    "monitor_stdout.log"
    "monitor_stderr.log"
    "launchd_stdout.log"
    "launchd_stderr.log"
)

echo "=== Log Rotation Started at $(date) ==="

for FILE_NAME in "${LOG_FILES[@]}"; do
    FILE_PATH="$LOG_DIR/$FILE_NAME"
    
    if [ -f "$FILE_PATH" ]; then
        FILE_SIZE=$(wc -c < "$FILE_PATH")
        echo "Checking $FILE_NAME: size is $FILE_SIZE bytes (threshold: $MAX_SIZE_BYTES)"
        
        if [ "$FILE_SIZE" -gt "$MAX_SIZE_BYTES" ]; then
            echo "Rotating $FILE_NAME..."
            
            # Remove the oldest backup if it exists
            if [ -f "$FILE_PATH.$BACKUP_COUNT" ]; then
                rm -f "$FILE_PATH.$BACKUP_COUNT"
            fi
            
            # Shift existing backups (.2 -> .3, .1 -> .2)
            for ((i=BACKUP_COUNT-1; i>=1; i--)); do
                if [ -f "$FILE_PATH.$i" ]; then
                    NEXT_IDX=$((i + 1))
                    mv "$FILE_PATH.$i" "$FILE_PATH.$NEXT_IDX"
                fi
            done
            
            # Copy active log file to .1 and truncate active file (copytruncate)
            cp -p "$FILE_PATH" "$FILE_PATH.1"
            : > "$FILE_PATH"
            
            echo "Rotation of $FILE_NAME completed."
        else
            echo "Rotation skipped for $FILE_NAME (size below threshold)."
        fi
    else
        echo "File $FILE_NAME does not exist. Skipping."
    fi
done

echo "=== Log Rotation Finished ==="
