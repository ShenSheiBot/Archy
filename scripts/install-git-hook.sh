#!/bin/bash
# Install global git hook to reject commits with Claude attribution
# Usage: curl -fsSL <url> | bash
#    or: ./install-git-hook.sh

set -e

HOOKS_DIR="$HOME/.git-hooks"
HOOK_FILE="$HOOKS_DIR/commit-msg"

echo "Installing global git commit-msg hook..."

# Create hooks directory
mkdir -p "$HOOKS_DIR"

# Write the hook
cat > "$HOOK_FILE" << 'EOF'
#!/bin/bash
# Global git hook to reject commits with Claude attribution

commit_msg_file="$1"
commit_msg=$(cat "$commit_msg_file")

# Check for any variation of "claude code" (case-insensitive)
if echo "$commit_msg" | grep -qi "claude code"; then
    echo "❌ COMMIT REJECTED: Contains 'claude code'"
    echo "   Please remove any Claude Code references from your commit message."
    exit 1
fi

# Check for Claude as co-author
if echo "$commit_msg" | grep -qi "Co-Authored-By.*Claude"; then
    echo "❌ COMMIT REJECTED: Contains Claude as co-author"
    echo "   Please remove Claude from Co-Authored-By."
    exit 1
fi

# Check for Anthropic email
if echo "$commit_msg" | grep -qi "noreply@anthropic.com"; then
    echo "❌ COMMIT REJECTED: Contains Anthropic email"
    echo "   Please remove any Anthropic references."
    exit 1
fi

exit 0
EOF

# Make executable
chmod +x "$HOOK_FILE"

# Set global hooks path
git config --global core.hooksPath "$HOOKS_DIR"

echo "✅ Global git hook installed successfully!"
echo "   Location: $HOOK_FILE"
echo "   Applies to all git repositories on this machine."
