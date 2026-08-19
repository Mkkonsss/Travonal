const Paths = {
  document: { uri: 'file:///data/user/0/com.app/files/' },
  cache: { uri: 'file:///data/user/0/com.app/cache/' },
};

class File {
  constructor(uri) {
    this.uri = uri;
    this.exists = true;
  }
  delete() {}
}

module.exports = { Paths, File };
