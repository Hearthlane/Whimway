import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;

/** Full official Maestro conversion; check-syntax alone misses eager swipe errors. */
public final class CheckNativeFlows {
  public static void main(String[] args) throws Exception {
    if (args.length != 1) throw new IllegalArgumentException("Provide the native-flow directory.");
    Path root = Path.of(args[0]).toRealPath();
    Class<?> reader = Class.forName("maestro.orchestra.yaml.YamlCommandReader");
    System.out.println("Official converter: " + reader.getProtectionDomain().getCodeSource().getLocation());
    Object instance = reader.getField("INSTANCE").get(null);
    Method convert = Arrays.stream(reader.getMethods())
        .filter(method -> method.getName().equals("readCommands$default") && method.getParameterCount() == 5)
        .findFirst().orElseThrow();
    List<Path> flows;
    try (var files = Files.walk(root)) {
      flows = files.filter(Files::isRegularFile)
          .filter(file -> file.toString().endsWith(".yaml") || file.toString().endsWith(".yml"))
          .sorted().toList();
    }
    if (flows.isEmpty() || flows.size() > 100) throw new IllegalArgumentException("Invalid native-flow count.");
    int failed = 0;
    for (Path flow : flows) {
      if (!flow.toRealPath().startsWith(root)) throw new IllegalArgumentException("Flow escaped native directory.");
      try {
        convert.invoke(null, instance, flow, null, 2, null);
        System.out.println("PARSED " + root.relativize(flow));
      } catch (InvocationTargetException error) {
        failed++;
        System.err.println("FAILED " + root.relativize(flow) + ": " + error.getCause());
        // Retain the real converter failure (including imported flow location
        // and NumberFormatException), not merely a shallow YAML syntax result.
        error.getCause().printStackTrace(System.err);
      }
    }
    System.out.println("Converted " + (flows.size() - failed) + "/" + flows.size() + " native flow graphs with official Maestro classes.");
    if (failed != 0) System.exit(1);
  }
}
