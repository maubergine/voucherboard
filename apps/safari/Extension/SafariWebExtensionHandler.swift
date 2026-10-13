import Foundation

// Safari needs a principal class for the extension. Voucherboard sends no native messages, so it answers with nothing.
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        context.completeRequest(returningItems: [], completionHandler: nil)
    }
}
