set positional-arguments

# List commands.
default:
    @just --list

# Install Chromium for visible windows and headless rendering (once).
setup:
    deno task setup

# Install the js3 command in Deno's global bin directory.
install:
    deno install --global --allow-all --force --name js3 --config deno.json main.ts

# Print setup instructions and the complete modeling workflow.
guide *args:
    deno run -A main.ts guide "$@"

# Emit portable modeling declarations and a typechecking config.
types *args:
    deno run -A main.ts types "$@"

# Create an editable starter model, without overwriting existing files.
init file *args:
    deno run -A main.ts init "$@"

# Validate a model and print geometry, bounds, and materials as JSON.
inspect file *args:
    deno run -A main.ts inspect "$@"

# Build model.glb, preview.png, report.json, and groom assets headlessly.
build file output="output/model" *args:
    deno run -A main.ts build "$@"

# Open a model in a visible Chromium window; watch its imported files.
open file *args:
    deno run -A main.ts open "$@"

# Keep a headless browser and live model server running.
headless file *args:
    deno run -A main.ts headless "$@"

# Run the server only; open the printed URL in any browser.
serve file *args:
    deno run -A main.ts serve "$@"

# Render a PNG in headless Chromium, then exit.
screenshot file output="output/model.png" *args:
    deno run -A main.ts screenshot "$@"

# Capture exact animation frames and a timestamp manifest in headless Chromium.
frames file output="output/frames" *args:
    deno run -A main.ts frames "$@"

# Export GLB, OBJ, or BLEND (BLEND requires background Blender).
export file output="output/model.glb" *args:
    deno run -A main.ts export "$@"

check:
    deno task check

test:
    deno task test
