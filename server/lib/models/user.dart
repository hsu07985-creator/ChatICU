/// User model
class User {
  User({
    required this.id,
    required this.name,
    required this.username,
    required this.password,
    required this.email,
    required this.role,
    required this.unit,
    required this.active,
    this.lastLogin,
    this.createdAt,
  });

  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      id: json['id'] as String,
      name: json['name'] as String,
      username: json['username'] as String,
      password: json['password'] as String,
      email: json['email'] as String,
      role: json['role'] as String,
      unit: json['unit'] as String,
      active: json['active'] as bool,
      lastLogin: json['lastLogin'] as String?,
      createdAt: json['createdAt'] as String?,
    );
  }

  final String id;
  final String name;
  final String username;
  final String password;
  final String email;
  final String role;
  final String unit;
  final bool active;
  final String? lastLogin;
  final String? createdAt;

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'username': username,
        'email': email,
        'role': role,
        'unit': unit,
        'active': active,
        'lastLogin': lastLogin,
        'createdAt': createdAt,
      };

  /// Returns user info without password
  Map<String, dynamic> toPublicJson() => {
        'id': id,
        'name': name,
        'username': username,
        'email': email,
        'role': role,
        'unit': unit,
        'lastLogin': lastLogin,
      };
}

