#include <ApplicationServices/ApplicationServices.h>
#include <unistd.h>

/**
 * Ultra-fast, 100% reliable native macOS CGEvent keyboard injector.
 * Direct HID layer Cmd+V injection bypassing AppleScript & System Events.
 */
int main() {
    CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
    if (!source) return 1;

    // Keycode 9 = V key on standard macOS layout
    CGEventRef vDown = CGEventCreateKeyboardEvent(source, (CGKeyCode)9, true);
    CGEventRef vUp = CGEventCreateKeyboardEvent(source, (CGKeyCode)9, false);

    if (vDown && vUp) {
        // Enforce Command flag exclusively, stripping interfering Option/Ctrl/Shift modifiers
        CGEventSetFlags(vDown, kCGEventFlagMaskCommand);
        CGEventSetFlags(vUp, kCGEventFlagMaskCommand);

        // Post directly to macOS HID System Event Tap
        CGEventPost(kCGHIDEventTap, vDown);
        usleep(15000); // 15ms key hold duration
        CGEventPost(kCGHIDEventTap, vUp);

        CFRelease(vDown);
        CFRelease(vUp);
    }

    CFRelease(source);
    return 0;
}
