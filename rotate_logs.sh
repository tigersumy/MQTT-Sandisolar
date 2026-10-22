#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${LOG_DIR:-$SCRIPT_DIR/logs}"
MAX_SIZE_BYTES=5242880 # 5 MB
BACKUP_COUNT=3

# Files to rotate (supports full paths or files in LOG_DIR)
TARGET_FILES=(
    "$LOG_DIR/monitor_stdout.log"
    "$LOG_DIR/monitor_stderr.log"
    "$LOG_DIR/launchd_stdout.log"
    "$LOG_DIR/launchd_stderr.log"
    "/private/tmp/zigbee2mqtt.log"
    "/private/tmp/zigbee2mqtt.err"
)

echo "=== Log Rotation Started at $(date) ==="

for FILE_PATH in "${TARGET_FILES[@]}"; do
    FILE_NAME=$(basename "$FILE_PATH")
    
    if [ -f "$FILE_PATH" ]; then
        FILE_SIZE=$(wc -c < "$FILE_PATH")
        echo "Checking $FILE_PATH: size is $FILE_SIZE bytes (threshold: $MAX_SIZE_BYTES)"
        
        if [ "$FILE_SIZE" -gt "$MAX_SIZE_BYTES" ]; then
            echo "Rotating $FILE_PATH..."
            
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
            
            echo "Rotation of $FILE_PATH completed."
        else
            echo "Rotation skipped for $FILE_PATH (size below threshold)."
        fi
    else
        echo "File $FILE_PATH does not exist. Skipping."
    fi
done

# Clean up Zigbee2MQTT log folders older than 7 days
Z2M_LOG_DIR="${Z2M_LOG_DIR:-$HOME/Zigbee2MQTT/data/log}"
if [ -d "$Z2M_LOG_DIR" ]; then
    echo "Cleaning up Zigbee2MQTT log folders older than 7 days..."
    find "$Z2M_LOG_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +7 -exec rm -rf {} +
fi

echo "=== Log Rotation Finished ==="
