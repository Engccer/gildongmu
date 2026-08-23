import Testing
import Foundation
@testable import GildongmuKit

private func parse(_ json: String) -> [String] {
    ChatSuggestionsService.parse(Data(json.utf8))
}

@Test func suggestionsParseNormalThree() {
    let result = parse(#"{"suggestions":["근처 카페는?","가는 길 알려줘","영업시간은?"]}"#)
    #expect(result == ["근처 카페는?", "가는 길 알려줘", "영업시간은?"])
}

@Test func suggestionsParseTruncatesToThree() {
    let result = parse(#"{"suggestions":["a","b","c","d","e"]}"#)
    #expect(result == ["a", "b", "c"])
}

@Test func suggestionsParseMissingKeyIsEmpty() {
    #expect(parse(#"{}"#).isEmpty)
    #expect(parse(#"{"other":["a"]}"#).isEmpty)
}

@Test func suggestionsParseNonArrayIsEmpty() {
    #expect(parse(#"{"suggestions":"a"}"#).isEmpty)
    #expect(parse(#"{"suggestions":null}"#).isEmpty)
    #expect(parse(#"{"suggestions":{"a":1}}"#).isEmpty)
}

@Test func suggestionsParseSkipsNonStringAndBlankItems() {
    let result = parse(#"{"suggestions":[1,"a",null," ","b",{"x":1}]}"#)
    #expect(result == ["a", "b"])
}

@Test func suggestionsParseInvalidJSONIsEmpty() {
    #expect(parse("<html>").isEmpty)
    #expect(parse("").isEmpty)
    #expect(parse(#"["a"]"#).isEmpty)
}
